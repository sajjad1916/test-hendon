// Slice 15 — 90-day history backfill.
//
// Two responsibilities, both idempotent:
//   1. Insert ~200–400 backdated `signal_events` distributed across the past
//      90 days, mix loosely matching PRD percentages (15/10/20/10/5). Only
//      backdated rows are wiped on re-run (`detected_at < date('now')`) so this
//      doesn't disturb today's events from `npm run generate-signals`.
//   2. Wipe + re-populate `surface_history` with ~30–40 agency rows spread
//      across 0–180 days, mixing tiers (hot/warm/long_term). The slice-17
//      classifier reads this to test the 60-day cooldown + 6-month floor.
//
// Run via:  npm run seed-history
// Importable as:  seedHistory()
//
// Determinism: re-uses the FNV-1a helper from `_shared.ts` so picks are stable
// across runs for the same agency set. Re-running produces ~the same counts.

import { db } from '../db';
import { fnv1a, type SignalType } from './signals/_shared';

interface AgencyRow {
  id: number;
  state: string | null;
  owner_age: number | null;
}

// PRD targets for the 5 signal types. Same percentages the live generator uses.
// Over a 90-day window, agencies can throw multiple historical signals — so each
// type gets up to N "passes," each gated independently in its own keyspace. With
// 100 agencies and these counts the total lands in the 200–400 range required
// by the slice-15 spec while still preserving the PRD percentage mix.
const SIGNAL_MIX: { type: SignalType; percent: number; passes: number; isInternal: boolean }[] = [
  { type: 'owner_age_70_plus',    percent: 15, passes: 4, isInternal: false },
  { type: 'hiring_gm',            percent: 10, passes: 4, isInternal: false },
  { type: 'review_velocity_spike', percent: 20, passes: 4, isInternal: false },
  { type: 'ad_activity_spike',    percent: 10, passes: 4, isInternal: false },
  { type: 'nearby_closed_deal',   percent: 5,  passes: 4, isInternal: true  },
];

const TIERS = ['hot', 'warm', 'long_term'] as const;
type Tier = typeof TIERS[number];

// Number of distinct agencies that get a surface_history row.
const SURFACE_HISTORY_TARGET = 35;

const fetchActiveAgencies = db.prepare(`
  SELECT id, state, owner_age
  FROM agencies
  WHERE tam_status = 'active'
  ORDER BY id
`);

const wipeBackdatedSignals = db.prepare(`
  DELETE FROM signal_events WHERE detected_at < date('now')
`);

const wipeSurfaceHistory = db.prepare('DELETE FROM surface_history');

const insertBackdatedSignal = db.prepare(`
  INSERT INTO signal_events (agency_id, signal_type, strength, evidence, is_internal, detected_at)
  VALUES (@agency_id, @signal_type, @strength, @evidence, @is_internal, @detected_at)
`);

const insertSurfaceHistory = db.prepare(`
  INSERT INTO surface_history (agency_id, surfaced_at, tier, drop_id)
  VALUES (@agency_id, @surfaced_at, @tier, NULL)
`);

// Same-style deterministic gate as `_shared.ts`'s shouldFire, but in its own
// keyspace per (agency, signal, pass) so backdated history doesn't correlate
// 1:1 with today's events and each pass adds independent variation.
const shouldBackfill = (
  agencyId: number,
  signalType: SignalType,
  pass: number,
  percent: number,
): boolean => {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = fnv1a(`${agencyId}|${signalType}|history|${pass}`);
  return h % 1000 < Math.round(percent * 10);
};

// Pick a deterministic offset (1..max days ago) for an (agency, signal, pass).
const pickDaysAgo = (
  agencyId: number,
  signalType: SignalType,
  pass: number,
  max: number,
): number => {
  const h = fnv1a(`${agencyId}|${signalType}|day|${pass}`);
  return 1 + (h % max); // 1..max
};

// ISO string "YYYY-MM-DD HH:MM:SS" N days before today, with a deterministic
// hour/minute drawn from the same hash so events don't all collapse to midnight.
const isoDaysAgo = (
  daysAgo: number,
  agencyId: number,
  signalType: SignalType,
  pass: number,
): string => {
  const h = fnv1a(`${agencyId}|${signalType}|time|${pass}`);
  const hour = h % 24;
  const minute = Math.floor(h / 24) % 60;
  const second = Math.floor(h / (24 * 60)) % 60;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, minute, second, 0);
  // SQLite-friendly format: "YYYY-MM-DD HH:MM:SS"
  return d.toISOString().slice(0, 19).replace('T', ' ');
};

const buildEvidence = (
  type: SignalType,
  agency: AgencyRow,
  daysAgo: number,
): Record<string, unknown> => {
  switch (type) {
    case 'owner_age_70_plus':
      return {
        source: 'historical_backfill',
        owner_age: agency.owner_age ?? 72,
        note: `Backdated ~${daysAgo}d ago — owner appears 70+.`,
      };
    case 'hiring_gm':
      return {
        source: 'historical_backfill',
        note: `Backdated ~${daysAgo}d ago — GM/operator hiring signal.`,
      };
    case 'review_velocity_spike':
      return {
        source: 'historical_backfill',
        review_count: 30 + (agency.id % 40),
        note: `Backdated ~${daysAgo}d ago — review-velocity spike.`,
      };
    case 'ad_activity_spike':
      return {
        source: 'historical_backfill',
        note: `Backdated ~${daysAgo}d ago — ad-activity spike.`,
      };
    case 'nearby_closed_deal':
      return {
        source: 'historical_backfill',
        state: agency.state,
        note: `Backdated ~${daysAgo}d ago — nearby Hendon close (internal).`,
      };
  }
};

interface HistorySummary {
  signalEvents: number;
  signalEventsByType: Record<SignalType, number>;
  surfaceHistoryRows: number;
  surfaceHistoryByTier: Record<Tier, number>;
  surfaceHistoryMinDays: number;
  surfaceHistoryMaxDays: number;
}

export const seedHistory = (): HistorySummary => {
  const counts: Record<SignalType, number> = {
    owner_age_70_plus: 0,
    hiring_gm: 0,
    review_velocity_spike: 0,
    ad_activity_spike: 0,
    nearby_closed_deal: 0,
  };
  const tierCounts: Record<Tier, number> = { hot: 0, warm: 0, long_term: 0 };
  let surfaceMin = Number.POSITIVE_INFINITY;
  let surfaceMax = Number.NEGATIVE_INFINITY;
  let surfaceTotal = 0;

  const txn = db.transaction(() => {
    // ─── 1. Backdated signal events ────────────────────────────────────────
    wipeBackdatedSignals.run();
    const agencies = fetchActiveAgencies.all() as AgencyRow[];
    for (const agency of agencies) {
      for (const { type, percent, passes, isInternal } of SIGNAL_MIX) {
        for (let pass = 0; pass < passes; pass++) {
          if (!shouldBackfill(agency.id, type, pass, percent)) continue;
          const daysAgo = pickDaysAgo(agency.id, type, pass, 90);
          insertBackdatedSignal.run({
            agency_id: agency.id,
            signal_type: type,
            strength: 0.85,
            evidence: JSON.stringify(buildEvidence(type, agency, daysAgo)),
            is_internal: isInternal ? 1 : 0,
            detected_at: isoDaysAgo(daysAgo, agency.id, type, pass),
          });
          counts[type]++;
        }
      }
    }

    // ─── 2. Surface history ────────────────────────────────────────────────
    wipeSurfaceHistory.run();
    if (agencies.length === 0) return;
    // Pick a deterministic subset of ~SURFACE_HISTORY_TARGET agency ids by
    // sorting on their FNV-1a hash. Stable across runs.
    const ranked = agencies
      .map((a) => ({ id: a.id, h: fnv1a(`surface|${a.id}`) }))
      .sort((a, b) => a.h - b.h)
      .slice(0, Math.min(SURFACE_HISTORY_TARGET, agencies.length));

    for (const { id } of ranked) {
      // Tier mix: hash-bucketed across 0..2.
      const tier = TIERS[fnv1a(`tier|${id}`) % 3] as Tier;
      // Days ago: deterministic 0..180.
      const daysAgo = fnv1a(`surfday|${id}`) % 181;
      const surfacedAt = isoDaysAgo(
        Math.max(daysAgo, 0),
        id,
        // Re-use signal-keyspace label to vary the hour/minute deterministically.
        'owner_age_70_plus',
        0,
      );
      insertSurfaceHistory.run({
        agency_id: id,
        surfaced_at: surfacedAt,
        tier,
      });
      tierCounts[tier]++;
      surfaceTotal++;
      if (daysAgo < surfaceMin) surfaceMin = daysAgo;
      if (daysAgo > surfaceMax) surfaceMax = daysAgo;
    }
  });
  txn();

  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return {
    signalEvents: total,
    signalEventsByType: counts,
    surfaceHistoryRows: surfaceTotal,
    surfaceHistoryByTier: tierCounts,
    surfaceHistoryMinDays: surfaceTotal > 0 ? surfaceMin : 0,
    surfaceHistoryMaxDays: surfaceTotal > 0 ? surfaceMax : 0,
  };
};

// Direct-execute path (npm run seed-history). Skipped on import.
const isMainModule = process.argv[1]?.endsWith('seed-history.ts') ||
  process.argv[1]?.endsWith('seed-history.js');
if (isMainModule) {
  const summary = seedHistory();
  console.log(
    `[seed-history] backdated ${summary.signalEvents} signal_events across the past 90 days:`,
  );
  for (const [type, n] of Object.entries(summary.signalEventsByType)) {
    console.log(`  · ${type.padEnd(24)} ${String(n).padStart(4)}`);
  }
  console.log(
    `[seed-history] surface_history: ${summary.surfaceHistoryRows} rows ` +
      `(hot ${summary.surfaceHistoryByTier.hot} · warm ${summary.surfaceHistoryByTier.warm} · ` +
      `long_term ${summary.surfaceHistoryByTier.long_term}); recency ` +
      `${summary.surfaceHistoryMinDays}–${summary.surfaceHistoryMaxDays} days ago`,
  );
}
