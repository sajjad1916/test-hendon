// Owner-age signal — fires when an agency's owner appears 70+.
// Single fire-rate gate at the PRD's 15%. Evidence path varies:
//   - agency.owner_age set and >= 70 → high-confidence (strength 1.0)
//   - otherwise → synthetic LinkedIn graduation-year (strength 0.6)
// Combining both paths under one shouldFire() gate keeps the total fire rate
// at exactly the PRD target regardless of how the seed/upload populates owner_age.
//
// PRD line 62 / depth guide §"Signal: owner age" — 15% of agencies fire.

import { shouldFire, insertSignalEvent, type AgencyForSignals } from './_shared';

const TARGET_PERCENT = 15;

export const generateOwnerAge = (agency: AgencyForSignals): boolean => {
  if (!shouldFire(agency.id, 'owner_age_70_plus', TARGET_PERCENT)) return false;

  if (agency.owner_age !== null && agency.owner_age >= 70) {
    insertSignalEvent({
      agencyId: agency.id,
      signalType: 'owner_age_70_plus',
      strength: 1.0,
      evidence: {
        source: 'agency_record',
        owner_age: agency.owner_age,
        note: `Owner age ${agency.owner_age}, well past typical retirement.`,
      },
    });
    return true;
  }

  // Synthesize a graduation year that implies 70+ today (2026): 1970–1976.
  const gradYear = 1970 + (agency.id % 7);
  insertSignalEvent({
    agencyId: agency.id,
    signalType: 'owner_age_70_plus',
    strength: 0.6,
    evidence: {
      source: 'linkedin_inferred',
      grad_year: gradYear,
      note: `Owner appears 70+ based on LinkedIn graduation year (${gradYear}).`,
    },
  });
  return true;
};
