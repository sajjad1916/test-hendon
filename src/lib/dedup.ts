// Dedup + cooldown + override (slice 17). The classifier asks shouldSurface()
// before writing a daily_drop row. Inside the cooldown window, an agency is
// suppressed unless one of the two override paths applies:
//   1. Internal signal bypass — a fresh nearby_closed_deal signal flips
//      cooldown off (depth guide §"User Story 3 — Internal signals").
//   2. Tier promotion bypass — long_term → hot is too important to silence
//      (Jon's "more wood behind fewer arrows" framing).
// Cooldown window comes from `settings.dedup.window_days` (default 60).
//
// recordSurface() writes to surface_history once daily_drop has been UPSERTed
// so subsequent classify runs see the new "last surface" timestamp.

import { db } from '../db';

export type Tier = 'hot' | 'warm' | 'long_term';

export type SurfaceReason =
  | 'no_prior_surface'
  | 'outside_cooldown'
  | 'internal_signal_bypass'
  | 'tier_promotion_bypass'
  | 'in_cooldown';

export interface SurfaceDecision {
  surface: boolean;
  reason: SurfaceReason;
  ageDays?: number;
  priorTier?: Tier | null;
}

const lastSurfaceStmt = db.prepare(
  `SELECT surfaced_at, tier FROM surface_history
   WHERE agency_id = ?
   ORDER BY surfaced_at DESC, id DESC
   LIMIT 1`,
);

const recordSurfaceStmt = db.prepare(
  `INSERT INTO surface_history (agency_id, tier, drop_id) VALUES (?, ?, ?)`,
);

const dayMs = 1000 * 60 * 60 * 24;

const ageDaysFromSqliteTimestamp = (sqliteTs: string): number => {
  const iso = sqliteTs.includes('T') ? sqliteTs : `${sqliteTs.replace(' ', 'T')}Z`;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / dayMs;
};

export const shouldSurface = (
  agencyId: number,
  currentTier: Tier,
  hasInternalSignal: boolean,
  windowDays: number,
): SurfaceDecision => {
  const last = lastSurfaceStmt.get(agencyId) as
    | { surfaced_at: string; tier: Tier }
    | undefined;

  if (!last) return { surface: true, reason: 'no_prior_surface' };

  const ageDays = ageDaysFromSqliteTimestamp(last.surfaced_at);
  if (ageDays >= windowDays) {
    return {
      surface: true,
      reason: 'outside_cooldown',
      ageDays: Math.round(ageDays),
      priorTier: last.tier,
    };
  }

  // Inside cooldown — bypass paths.
  if (hasInternalSignal) {
    return {
      surface: true,
      reason: 'internal_signal_bypass',
      ageDays: Math.round(ageDays),
      priorTier: last.tier,
    };
  }

  if (last.tier === 'long_term' && currentTier === 'hot') {
    return {
      surface: true,
      reason: 'tier_promotion_bypass',
      ageDays: Math.round(ageDays),
      priorTier: last.tier,
    };
  }

  return {
    surface: false,
    reason: 'in_cooldown',
    ageDays: Math.round(ageDays),
    priorTier: last.tier,
  };
};

export const recordSurface = (
  agencyId: number,
  tier: Tier,
  dropId: number | null = null,
): void => {
  recordSurfaceStmt.run(agencyId, tier, dropId);
};
