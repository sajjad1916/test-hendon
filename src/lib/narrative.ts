// Narrative fill (slice 18). The classifier (slice 16) writes daily_drop
// rows with empty `reason` / `key_signals` for newly-surfaced agencies.
// This module fills those columns by resolving `signal_event_ids` →
// signal_types and calling pickReason() from the slice-6 fixture pool.
//
// Cache + determinism: pickReason() FNV-1a-hashes `${agencyId}|${sorted_tags}`,
// so the same agency + same signal set always returns the same fixture.
// Re-running fill-reasons is a no-op (the WHERE clause filters out rows
// that already have text).
//
// Slice 11's auto-enrich path writes its own reason text on commit; we
// never overwrite a populated row.
//
// Run via:  npm run fill-reasons
//
// Production swap: replace pickReason() with a real OpenRouter Lightweight
// call behind the same signature. Cache key stays (agency, signal-set).

import { db } from '../db';
import { pickReason, type SignalLike } from './fixtures/select';
import type { SignalTag, Tier } from './fixtures/_types';

interface EmptyDropRow {
  id: number;
  agency_id: number;
  tier: Tier;
  signal_event_ids: string | null;
}

const fetchEmptyDrops = db.prepare(`
  SELECT id, agency_id, tier, signal_event_ids
  FROM daily_drop
  WHERE drop_date = date('now')
    AND (reason IS NULL OR reason = '')
  ORDER BY agency_id
`);

// SQLite's json_each() lets us treat the JSON-array text column as a row set
// for an IN(...) subquery. Faster than parsing in JS for hundreds of rows.
const fetchSignalTypesForIds = db.prepare(`
  SELECT signal_type FROM signal_events
  WHERE id IN (SELECT CAST(value AS INTEGER) FROM json_each(?))
`);

const updateDropReason = db.prepare(`
  UPDATE daily_drop
  SET reason = @reason, key_signals = @key_signals
  WHERE id = @id
`);

export interface FillResult {
  candidates: number;
  filled: number;
  skipped: number;
}

const KNOWN_SIGNAL_TAGS: ReadonlySet<SignalTag> = new Set([
  'owner_age_70_plus',
  'owner_age_65_plus',
  'hiring_gm',
  'review_velocity_spike',
  'ad_activity_spike',
  'nearby_closed_deal',
  'website_change_gm',
  'website_change_services',
  'linkedin_active_ma',
  'linkedin_inactive',
  'website_static',
]);

export const fillReasonsForToday = (): FillResult => {
  const rows = fetchEmptyDrops.all() as EmptyDropRow[];
  let filled = 0;
  let skipped = 0;

  const txn = db.transaction(() => {
    for (const row of rows) {
      let signalIds: number[] = [];
      try {
        signalIds = JSON.parse(row.signal_event_ids ?? '[]');
      } catch {
        skipped++;
        continue;
      }

      // Resolve to signal_types. If signalIds is empty, skip the lookup.
      let signals: SignalLike[] = [];
      if (signalIds.length > 0) {
        const types = fetchSignalTypesForIds.all(JSON.stringify(signalIds)) as {
          signal_type: string;
        }[];
        signals = types
          .filter((t) => KNOWN_SIGNAL_TAGS.has(t.signal_type as SignalTag))
          .map((t) => ({ type: t.signal_type as SignalTag }));
      }

      const fixture = pickReason(signals, row.tier, row.agency_id);

      updateDropReason.run({
        id: row.id,
        reason: fixture.reason,
        key_signals: fixture.keySignals,
      });
      filled++;
    }
  });

  txn();
  return { candidates: rows.length, filled, skipped };
};

const isMainModule =
  process.argv[1]?.endsWith('narrative.ts') ||
  process.argv[1]?.endsWith('narrative.js');
if (isMainModule) {
  const r = fillReasonsForToday();
  if (r.candidates === 0) {
    console.log(`[fill-reasons] no daily_drop rows need a Reason today (already populated).`);
  } else {
    console.log(
      `[fill-reasons] filled ${r.filled} of ${r.candidates} candidate row${r.candidates === 1 ? '' : 's'}` +
        (r.skipped > 0 ? ` (${r.skipped} skipped due to malformed signal_event_ids)` : ''),
    );
  }
}
