// Tier classifier (slice 16). For every active agency:
//   1. Fetch the agency's signal_events from the last N days (default 90)
//   2. Group by signal_type, taking max(strength) per type so duplicate
//      signals don't double-count
//   3. score = Σ (max_strength_per_type × weight_per_type)
//   4. tier = 'hot' if score ≥ thresholds.hot, 'warm' if ≥ thresholds.warm,
//      else 'long_term'
//   5. UPSERT today's daily_drop row. Slice 11's auto-enrich may have already
//      populated reason / key_signals — we DO NOT overwrite those, only the
//      tier + signal_event_ids. Slice 18 will fill empty reasons.
//
// Weights and thresholds are configurable via the settings table. Defaults are
// seeded on first run (INSERT OR IGNORE) so the toggle panel (slice 19) can
// edit them without a migration round-trip.
//
// Out of scope: dedup / cooldown (slice 17); Reason text (slice 18); cron
// scheduling (slice 22).
//
// Run via:  npm run classify

import { db } from '../db';
import type { SignalType } from './signals/_shared';
import { shouldSurface, recordSurface, type SurfaceReason } from './dedup';

type Tier = 'hot' | 'warm' | 'long_term';

interface TierWeights {
  owner_age_70_plus: number;
  hiring_gm: number;
  review_velocity_spike: number;
  ad_activity_spike: number;
  nearby_closed_deal: number;
}

interface TierThresholds {
  hot: number;
  warm: number;
}

const DEFAULT_WEIGHTS: TierWeights = {
  owner_age_70_plus: 3,
  hiring_gm: 2,
  review_velocity_spike: 1,
  ad_activity_spike: 1,
  nearby_closed_deal: 4,
};

// Threshold tuning: with the prototype's signal-rich seed (slice 14 + slice 15
// → ~280 events across 90 days for 100 agencies), a single moderate signal
// shouldn't trip "hot." hot=6 requires roughly two strong signals or one
// nearby_deal stacked with one other.
const DEFAULT_THRESHOLDS: TierThresholds = {
  hot: 6,
  warm: 2,
};

const SETTINGS_KEYS = {
  weights: 'tier.weights',
  thresholds: 'tier.thresholds',
} as const;

const seedTierConfigIfMissing = (): void => {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  );
  stmt.run(SETTINGS_KEYS.weights, JSON.stringify(DEFAULT_WEIGHTS));
  stmt.run(SETTINGS_KEYS.thresholds, JSON.stringify(DEFAULT_THRESHOLDS));
};

const loadTierConfig = (): {
  weights: TierWeights;
  thresholds: TierThresholds;
} => {
  const rows = db
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'tier.%'")
    .all() as { key: string; value: string }[];
  const map = new Map(rows.map((r) => [r.key, r.value]));

  let weights: TierWeights = DEFAULT_WEIGHTS;
  const wRaw = map.get(SETTINGS_KEYS.weights);
  if (wRaw) {
    try {
      const parsed = JSON.parse(wRaw);
      weights = { ...DEFAULT_WEIGHTS, ...parsed };
    } catch {
      // fall through to defaults
    }
  }

  let thresholds: TierThresholds = DEFAULT_THRESHOLDS;
  const tRaw = map.get(SETTINGS_KEYS.thresholds);
  if (tRaw) {
    try {
      const parsed = JSON.parse(tRaw);
      thresholds = { ...DEFAULT_THRESHOLDS, ...parsed };
    } catch {
      // fall through
    }
  }

  return { weights, thresholds };
};

interface SignalRow {
  id: number;
  signal_type: SignalType;
  strength: number;
}

export const computeTier = (
  signals: ReadonlyArray<{ signal_type: SignalType; strength: number }>,
  weights: TierWeights,
  thresholds: TierThresholds,
): { tier: Tier; score: number } => {
  // Take the strongest event per signal_type so dup events don't compound.
  const maxByType = new Map<SignalType, number>();
  for (const s of signals) {
    const cur = maxByType.get(s.signal_type) ?? 0;
    if (s.strength > cur) maxByType.set(s.signal_type, s.strength);
  }

  let score = 0;
  for (const [type, strength] of maxByType) {
    const w = weights[type as keyof TierWeights] ?? 0;
    score += strength * w;
  }

  let tier: Tier;
  if (score >= thresholds.hot) tier = 'hot';
  else if (score >= thresholds.warm) tier = 'warm';
  else tier = 'long_term';

  return { tier, score };
};

const fetchActiveAgencies = db.prepare(
  "SELECT id FROM agencies WHERE tam_status = 'active' ORDER BY id",
);

const fetchRecentSignalsForAgency = db.prepare(
  `SELECT id, signal_type, strength FROM signal_events
   WHERE agency_id = ? AND detected_at >= datetime('now', ?)`,
);

// Preserve any existing reason/key_signals (set by slice 11's auto-enrich
// or slice 18's Reason picker). Only update tier + signal_event_ids on
// today's row.
const upsertDailyDrop = db.prepare(`
  INSERT INTO daily_drop (agency_id, drop_date, tier, reason, key_signals, signal_event_ids)
  VALUES (@agency_id, date('now'), @tier, '', '', @signal_event_ids)
  ON CONFLICT (agency_id, drop_date) DO UPDATE SET
    tier = excluded.tier,
    signal_event_ids = excluded.signal_event_ids
`);

export interface ClassifyResult {
  classified: number;
  tierCounts: Record<Tier, number>;
  zeroSignalAgencies: number;
  surfaced: number;
  skipped: number;
  reasonCounts: Record<SurfaceReason, number>;
}

const DEFAULT_DEDUP_WINDOW_DAYS = 60;

const loadDedupWindowDays = (): number => {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'dedup.window_days'")
    .get() as { value: string } | undefined;
  if (!row) return DEFAULT_DEDUP_WINDOW_DAYS;
  const n = Number(row.value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DEDUP_WINDOW_DAYS;
};

export const classifyAll = (opts: { recentDays?: number } = {}): ClassifyResult => {
  seedTierConfigIfMissing();
  const { weights, thresholds } = loadTierConfig();
  const dedupWindowDays = loadDedupWindowDays();
  const recentDays = opts.recentDays ?? 90;
  const cutoff = `-${recentDays} days`;

  const tierCounts: Record<Tier, number> = { hot: 0, warm: 0, long_term: 0 };
  const reasonCounts: Record<SurfaceReason, number> = {
    no_prior_surface: 0,
    outside_cooldown: 0,
    internal_signal_bypass: 0,
    tier_promotion_bypass: 0,
    in_cooldown: 0,
  };
  let classified = 0;
  let surfaced = 0;
  let skipped = 0;
  let zeroSignalAgencies = 0;

  const txn = db.transaction(() => {
    const agencies = fetchActiveAgencies.all() as { id: number }[];
    for (const a of agencies) {
      const signals = fetchRecentSignalsForAgency.all(
        a.id,
        cutoff,
      ) as SignalRow[];

      if (signals.length === 0) zeroSignalAgencies++;

      const { tier } = computeTier(signals, weights, thresholds);
      tierCounts[tier]++;
      classified++;

      const hasInternalSignal = signals.some(
        (s) => s.signal_type === 'nearby_closed_deal',
      );

      const decision = shouldSurface(
        a.id,
        tier,
        hasInternalSignal,
        dedupWindowDays,
      );
      reasonCounts[decision.reason]++;

      if (!decision.surface) {
        skipped++;
        continue;
      }

      const signalIds = signals.map((s) => s.id);
      upsertDailyDrop.run({
        agency_id: a.id,
        tier,
        signal_event_ids: JSON.stringify(signalIds),
      });
      recordSurface(a.id, tier, null);
      surfaced++;
    }
  });

  txn();

  return {
    classified,
    tierCounts,
    zeroSignalAgencies,
    surfaced,
    skipped,
    reasonCounts,
  };
};

const isMainModule =
  process.argv[1]?.endsWith('classifier.ts') ||
  process.argv[1]?.endsWith('classifier.js');
if (isMainModule) {
  const result = classifyAll();
  const { classified, tierCounts, zeroSignalAgencies, surfaced, skipped, reasonCounts } = result;
  console.log(
    `[classify] classified ${classified} active agencies (${zeroSignalAgencies} had no recent signals → long_term)`,
  );
  console.log(`           surfaced ${surfaced} · skipped ${skipped} (in cooldown)`);
  console.log(`  Tiers (across all classified):`);
  for (const [tier, n] of Object.entries(tierCounts)) {
    const pct = classified > 0 ? ((n / classified) * 100).toFixed(1) : '0.0';
    console.log(`    · ${tier.padEnd(10)} ${String(n).padStart(4)}  (${pct}%)`);
  }
  console.log(`  Surface decisions:`);
  for (const [reason, n] of Object.entries(reasonCounts)) {
    if (n === 0) continue;
    console.log(`    · ${reason.padEnd(26)} ${String(n).padStart(4)}`);
  }
}
