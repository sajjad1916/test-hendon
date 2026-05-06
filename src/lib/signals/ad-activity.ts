// Ad-activity signal — fires when an agency's ad volume jumped sharply in the
// last 30 days vs. the trailing 90-day baseline. Pulls a ZenRows fixture
// tagged 'ad_activity_spike' (3 fixtures available).
//
// PRD line 62 / depth guide §"Signal: ad activity changes" — 10% of agencies fire.

import { ZENROWS_RESPONSES } from '../fixtures/zenrows-responses';
import { fnv1a, shouldFire, insertSignalEvent, type AgencyForSignals } from './_shared';

const TARGET_PERCENT = 10;

const AD_FIXTURES = ZENROWS_RESPONSES.filter(
  (z) => z.tag === 'ad_activity_spike',
);

export const generateAdActivity = (agency: AgencyForSignals): boolean => {
  if (!shouldFire(agency.id, 'ad_activity_spike', TARGET_PERCENT)) return false;
  if (AD_FIXTURES.length === 0) return false;

  const fixture =
    AD_FIXTURES[fnv1a(`${agency.id}|ad_activity|pick`) % AD_FIXTURES.length]!;

  insertSignalEvent({
    agencyId: agency.id,
    signalType: 'ad_activity_spike',
    strength: 0.75,
    evidence: {
      source: 'google_ads_transparency',
      source_kind: fixture.source,
      fixture_id: fixture.id,
      note: 'Sharp ad-volume increase vs. trailing 90-day baseline.',
    },
  });
  return true;
};
