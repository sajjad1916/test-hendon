// Nearby-Hendon-closed-deal signal — internal, bypasses dedup cooldown.
// Reads from the `hendon_closed_deals` table (seeded by the orchestrator if
// empty). For each agency, deterministically pick a deal:
//   1. Prefer a deal in the same state (proper "nearby")
//   2. Otherwise fall back to any deal (still useful as "we know your market")
// Fire on ~5% of agencies per the PRD.
//
// Depth guide §"Signal: nearby Hendon closed deal" — internal signal,
// is_internal=1; should override dedup cooldown in the classifier (slice 17).

import { db } from '../../db';
import { fnv1a, shouldFire, insertSignalEvent, type AgencyForSignals } from './_shared';

const TARGET_PERCENT = 5;

interface ClosedDealRow {
  id: number;
  agency_name: string;
  city: string | null;
  state: string | null;
  closed_at: string;
}

const findDealsByState = db.prepare(
  'SELECT id, agency_name, city, state, closed_at FROM hendon_closed_deals WHERE state = ?',
);

const findAnyDeals = db.prepare(
  'SELECT id, agency_name, city, state, closed_at FROM hendon_closed_deals',
);

export const generateNearbyDeal = (agency: AgencyForSignals): boolean => {
  if (!shouldFire(agency.id, 'nearby_closed_deal', TARGET_PERCENT)) return false;

  const sameStateDeals = agency.state
    ? (findDealsByState.all(agency.state) as ClosedDealRow[])
    : [];
  const candidates =
    sameStateDeals.length > 0 ? sameStateDeals : (findAnyDeals.all() as ClosedDealRow[]);

  if (candidates.length === 0) return false;

  const deal = candidates[fnv1a(`${agency.id}|nearby_deal|pick`) % candidates.length]!;
  const sameState = deal.state === agency.state;

  insertSignalEvent({
    agencyId: agency.id,
    signalType: 'nearby_closed_deal',
    strength: 1.0,
    isInternal: true,
    evidence: {
      source: 'hendon_internal',
      deal_id: deal.id,
      deal_name: deal.agency_name,
      deal_city: deal.city,
      deal_state: deal.state,
      closed_at: deal.closed_at,
      proximity: sameState ? 'same_state' : 'same_market',
      note: sameState
        ? `Hendon closed ${deal.agency_name} in ${deal.city ?? deal.state ?? 'the same state'}.`
        : `Hendon closed ${deal.agency_name} in ${deal.state ?? 'a nearby market'}.`,
    },
  });
  return true;
};
