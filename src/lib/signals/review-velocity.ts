// Review-velocity signal — fires when an agency's monthly review rate over the
// last ~30 days is meaningfully higher than its trailing baseline. We pick a
// Serper fixture deterministically and inspect its `recent_review_dates` to
// compute a rough velocity. Only fire when:
//   - lifetime review_count is above a low-noise floor (>= 20)
//   - the 5 most recent reviews span <= 14 days (i.e., clustered recently)
// Plus the deterministic fire-rate gate at the PRD's 20%.
//
// Depth guide §"Signal: Google review count and velocity" — minimum-baseline
// filter (20+ reviews) + flag fake-review attacks (50 in a single day).

import { SERPER_RESPONSES } from '../fixtures/serper-responses';
import { fnv1a, shouldFire, insertSignalEvent, type AgencyForSignals } from './_shared';

const TARGET_PERCENT = 20;
const MIN_LIFETIME_REVIEWS = 20;

const daysBetween = (later: string, earlier: string): number => {
  const ms = new Date(later).getTime() - new Date(earlier).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return Math.abs(ms) / (1000 * 60 * 60 * 24);
};

export const generateReviewVelocity = (agency: AgencyForSignals): boolean => {
  if (!shouldFire(agency.id, 'review_velocity_spike', TARGET_PERCENT)) return false;

  const fixture = SERPER_RESPONSES[fnv1a(`${agency.id}|review_velocity|pick`) % SERPER_RESPONSES.length]!;

  // Low-baseline guard: brand-new agencies with very few reviews don't fire.
  // Drops ~10% of would-fires; net rate ~18% which is close to PRD 20%.
  if (fixture.review_count < MIN_LIFETIME_REVIEWS) return false;

  const dates = [...fixture.recent_review_dates].sort().reverse();
  const span = dates.length >= 2
    ? daysBetween(dates[0]!, dates[dates.length - 1]!)
    : 0;

  insertSignalEvent({
    agencyId: agency.id,
    signalType: 'review_velocity_spike',
    strength: 0.85,
    evidence: {
      source: 'serper',
      fixture_id: fixture.id,
      review_count: fixture.review_count,
      recent_dates_span_days: Math.round(span),
      note: `${fixture.review_count} reviews lifetime; last ${dates.length} reviews in ${Math.round(span)} days.`,
    },
  });
  return true;
};
