// Run-cycle orchestrator (slice 22). Glues the existing pieces together
// so a single call from POST /run-cycle does the demo:
//
//   pick a quota's worth of agencies → run all 5 generators on them
//   (incrementally — no signal_events wipe) → classifyAll() →
//   fillReasonsForToday() → buildSheetRows() → optional writeToLiveSheet()
//
// Different from `npm run generate-signals` which truncates signal_events
// for a clean re-seed: run-cycle is additive so accumulated history stays
// intact. Joseph clicks the button repeatedly and watches new rows appear.

import { db } from '../db';
import { generateOwnerAge } from './signals/owner-age';
import { generateHiringGm } from './signals/hiring-gm';
import { generateReviewVelocity } from './signals/review-velocity';
import { generateAdActivity } from './signals/ad-activity';
import { generateNearbyDeal } from './signals/nearby-deal';
import { classifyAll } from './classifier';
import { fillReasonsForToday } from './narrative';
import { buildSheetRows, writeToLiveSheet } from './sheets';
import { loadSheetsConfig } from '../config/sheets';
import { getNumber } from './settings';
import type { AgencyForSignals } from './signals/_shared';

export interface RunCycleResult {
  agenciesProcessed: number;
  newSignals: number;
  surfaced: number;
  hot: number;
  warm: number;
  longTerm: number;
  reasonsFilled: number;
  sheetMode: 'live' | 'dry_run';
  sheetRows: number;
  durationMs: number;
}

const fetchUnSurfacedActiveAgencies = db.prepare(`
  SELECT id, name, state, owner_age, domain
  FROM agencies a
  WHERE a.tam_status = 'active'
    AND NOT EXISTS (
      SELECT 1 FROM daily_drop d
      WHERE d.agency_id = a.id AND d.drop_date = date('now')
    )
  ORDER BY a.id
  LIMIT ?
`);

const countSignalEventsTotal = db.prepare(
  'SELECT count(*) AS n FROM signal_events',
);

export const runCycle = async (): Promise<RunCycleResult> => {
  const startMs = Date.now();
  const quota = getNumber('quota.icp_per_day', 100);

  const beforeSignals = (countSignalEventsTotal.get() as { n: number }).n;

  // 1. Run all 5 generators on the next batch of un-surfaced agencies.
  // No truncate — additive vs. `generateAllSignals()`.
  const agencies = fetchUnSurfacedActiveAgencies.all(quota) as AgencyForSignals[];
  const genTxn = db.transaction(() => {
    for (const a of agencies) {
      generateOwnerAge(a);
      generateHiringGm(a);
      generateReviewVelocity(a);
      generateAdActivity(a);
      generateNearbyDeal(a);
    }
  });
  genTxn();

  const afterSignals = (countSignalEventsTotal.get() as { n: number }).n;
  const newSignals = afterSignals - beforeSignals;

  // 2. Re-classify (subject to dedup). New signals tip more agencies into
  //    surfaceable buckets; cooldown still suppresses already-surfaced rows.
  const classifyResult = classifyAll();

  // 3. Fill any newly-empty reason / key_signals on today's daily_drop.
  const fillResult = fillReasonsForToday();

  // 4. Build the sheet rows. If GOOGLE_SHEETS_* are configured, write live;
  //    otherwise stay dry-run (the demo prints to stdout via npm run write-sheet).
  const build = buildSheetRows();
  const config = loadSheetsConfig();
  let sheetMode: 'live' | 'dry_run' = 'dry_run';
  if (config.configured) {
    try {
      await writeToLiveSheet(build, {
        sheetId: config.sheetId,
        credentialsPath: config.credentialsPath,
      });
      sheetMode = 'live';
    } catch (err) {
      // Don't fail the whole cycle if Sheets is mis-configured.
      // The dashboard will surface the dry-run mode in its response.
      console.error('[run-cycle] sheet write failed, staying dry-run:', err);
      sheetMode = 'dry_run';
    }
  }

  return {
    agenciesProcessed: agencies.length,
    newSignals,
    surfaced: classifyResult.surfaced,
    hot: classifyResult.tierCounts.hot,
    warm: classifyResult.tierCounts.warm,
    longTerm: classifyResult.tierCounts.long_term,
    reasonsFilled: fillResult.filled,
    sheetMode,
    sheetRows: build.summary.totalRows,
    durationMs: Date.now() - startMs,
  };
};
