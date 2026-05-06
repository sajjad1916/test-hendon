// Signal-generation orchestrator (slice 14). Runs all five fixture-driven
// generators across every active agency, in one transaction, and prints the
// per-type breakdown so you can compare against the PRD percentages
// (15 / 10 / 20 / 10 / 5 for owner_age / hiring_gm / review_velocity /
// ad_activity / nearby_deal).
//
// Idempotent: truncates signal_events first; seeds a small set of
// `hendon_closed_deals` if the table is empty so nearby-deal can fire.
// Run via:  npm run generate-signals

import { db } from '../../db';
import type { AgencyForSignals, SignalType } from './_shared';
import { generateOwnerAge } from './owner-age';
import { generateHiringGm } from './hiring-gm';
import { generateReviewVelocity } from './review-velocity';
import { generateAdActivity } from './ad-activity';
import { generateNearbyDeal } from './nearby-deal';

interface ClosedDealSeed {
  agency_name: string;
  address: string;
  city: string;
  state: string;
  closed_at: string;
}

const FAKE_CLOSED_DEALS: ClosedDealSeed[] = [
  {
    agency_name: "Bob's Home Care of Cleveland",
    address: '4200 Lakeshore Blvd',
    city: 'Cleveland',
    state: 'OH',
    closed_at: '2026-02-15',
  },
  {
    agency_name: 'Pinewood Home Care of Albany',
    address: '900 Washington Ave',
    city: 'Albany',
    state: 'NY',
    closed_at: '2026-01-20',
  },
  {
    agency_name: 'Sunrise Home Care of Newark',
    address: '88 Broad St',
    city: 'Newark',
    state: 'NJ',
    closed_at: '2026-03-10',
  },
  {
    agency_name: 'Coastal Senior Living of Tampa',
    address: '4407 Kennedy Blvd',
    city: 'Tampa',
    state: 'FL',
    closed_at: '2025-12-05',
  },
  {
    agency_name: 'Heritage Home Health of Phoenix',
    address: '8800 N Central Ave',
    city: 'Phoenix',
    state: 'AZ',
    closed_at: '2026-04-01',
  },
];

const insertClosedDeal = db.prepare(`
  INSERT INTO hendon_closed_deals (agency_name, address, city, state, closed_at)
  VALUES (@agency_name, @address, @city, @state, @closed_at)
`);

const seedClosedDealsIfEmpty = (): number => {
  const existing = (db.prepare('SELECT count(*) AS n FROM hendon_closed_deals').get() as { n: number }).n;
  if (existing > 0) return existing;
  const txn = db.transaction(() => {
    for (const d of FAKE_CLOSED_DEALS) insertClosedDeal.run(d);
  });
  txn();
  return FAKE_CLOSED_DEALS.length;
};

const fetchActiveAgencies = db.prepare(`
  SELECT id, name, state, owner_age, domain
  FROM agencies
  WHERE tam_status = 'active'
  ORDER BY id
`);

export const generateAllSignals = (): Record<SignalType, number> => {
  const counts: Record<SignalType, number> = {
    owner_age_70_plus: 0,
    hiring_gm: 0,
    review_velocity_spike: 0,
    ad_activity_spike: 0,
    nearby_closed_deal: 0,
  };

  const txn = db.transaction(() => {
    db.exec('DELETE FROM signal_events;');
    const agencies = fetchActiveAgencies.all() as AgencyForSignals[];
    for (const agency of agencies) {
      if (generateOwnerAge(agency)) counts.owner_age_70_plus++;
      if (generateHiringGm(agency)) counts.hiring_gm++;
      if (generateReviewVelocity(agency)) counts.review_velocity_spike++;
      if (generateAdActivity(agency)) counts.ad_activity_spike++;
      if (generateNearbyDeal(agency)) counts.nearby_closed_deal++;
    }
  });
  txn();

  return counts;
};

// Direct-execute path (npm run generate-signals).
// Skipped if this module is just imported.
const isMainModule = process.argv[1]?.endsWith('signals/index.ts') ||
  process.argv[1]?.endsWith('signals/index.js');
if (isMainModule) {
  const dealCount = seedClosedDealsIfEmpty();
  if (dealCount > 0) {
    console.log(`[signals] hendon_closed_deals: ${dealCount} rows present`);
  }

  const totalAgencies = (
    db.prepare("SELECT count(*) AS n FROM agencies WHERE tam_status = 'active'").get() as { n: number }
  ).n;

  const counts = generateAllSignals();
  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  console.log(`[signals] generated ${total} signal events across ${totalAgencies} active agencies:`);
  for (const [type, n] of Object.entries(counts)) {
    const pct = totalAgencies > 0 ? ((n / totalAgencies) * 100).toFixed(1) : '0.0';
    console.log(`  · ${type.padEnd(24)} ${String(n).padStart(4)}  (${pct}%)`);
  }
}
