// Shared helpers for the slice-14 signal generators.
// All generators use the same deterministic fire-rate sampler (FNV-1a on
// agency.id + signal type) so the prototype's signal mix is reproducible
// across runs. Each generator picks fixture-driven evidence and writes one
// row to signal_events via insertSignalEvent().

import { db } from '../../db';

export type SignalType =
  | 'owner_age_70_plus'
  | 'hiring_gm'
  | 'review_velocity_spike'
  | 'ad_activity_spike'
  | 'nearby_closed_deal';

export interface AgencyForSignals {
  id: number;
  name: string;
  state: string | null;
  owner_age: number | null;
  domain: string | null;
}

const fnv1a = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h;
};

// Deterministic fire-rate sampler. percent=15 → 15% of agency-ids fire.
// Uses a separate keyspace per signalType so signals don't co-fire on the
// same agencies more often than the joint probability would imply.
export const shouldFire = (
  agencyId: number,
  signalType: SignalType,
  percent: number,
): boolean => {
  if (percent <= 0) return false;
  if (percent >= 100) return true;
  const h = fnv1a(`${agencyId}|${signalType}|fire`);
  return h % 1000 < Math.round(percent * 10);
};

const insertSignalEventStmt = db.prepare(`
  INSERT INTO signal_events (agency_id, signal_type, strength, evidence, is_internal)
  VALUES (@agency_id, @signal_type, @strength, @evidence, @is_internal)
`);

export interface SignalEventInput {
  agencyId: number;
  signalType: SignalType;
  strength?: number; // default 1.0
  evidence: Record<string, unknown>;
  isInternal?: boolean; // default false
}

export const insertSignalEvent = (e: SignalEventInput): void => {
  insertSignalEventStmt.run({
    agency_id: e.agencyId,
    signal_type: e.signalType,
    strength: e.strength ?? 1.0,
    evidence: JSON.stringify(e.evidence),
    is_internal: e.isInternal ? 1 : 0,
  });
};

export { fnv1a };
