// Hiring-GM signal — fires when an agency posts a General Manager / Director of
// Operations role. Pulls a ZenRows fixture tagged 'website_change_gm' for evidence.
//
// PRD line 62 / depth guide §"Signal: hiring a general manager" — 10% of agencies fire.

import { ZENROWS_RESPONSES } from '../fixtures/zenrows-responses';
import { fnv1a, shouldFire, insertSignalEvent, type AgencyForSignals } from './_shared';

const TARGET_PERCENT = 10;

const GM_FIXTURES = ZENROWS_RESPONSES.filter((z) => z.tag === 'website_change_gm');

export const generateHiringGm = (agency: AgencyForSignals): boolean => {
  if (!shouldFire(agency.id, 'hiring_gm', TARGET_PERCENT)) return false;
  if (GM_FIXTURES.length === 0) return false;

  const fixture = GM_FIXTURES[fnv1a(`${agency.id}|hiring_gm|pick`) % GM_FIXTURES.length]!;

  insertSignalEvent({
    agencyId: agency.id,
    signalType: 'hiring_gm',
    strength: 0.9,
    evidence: {
      source: 'zenrows',
      source_kind: fixture.source,
      fixture_id: fixture.id,
      note: 'Recent job post for General Manager / Director of Operations.',
    },
  });
  return true;
};
