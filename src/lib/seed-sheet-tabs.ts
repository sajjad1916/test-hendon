// Pre-populate 4 historical date tabs (slice 22). Lets Joseph see the
// daily-drop pattern immediately on a fresh demo — without waiting for
// run-cycle to be clicked four times across four days.
//
// Strategy: take today's daily_drop rows (built by buildSheetRows()), and
// for each historical date offset (-14, -7, -3, -1) write a subset to a
// tab named with that date. The "Created" column gets relabeled to the
// historical date so the row text reads consistently. The subset ratio
// varies by offset so the tabs don't look identical.
//
// Dry-run by default if Sheets isn't configured; live writes happen
// when GOOGLE_SHEETS_SHEET_ID + GOOGLE_SHEETS_CREDENTIALS_JSON_PATH are set.
//
// Run via:  npm run seed-sheet-tabs

import 'dotenv/config';
import {
  buildSheetRows,
  runDryRun,
  writeToLiveSheet,
  HEADER_ROW,
  type SheetBuild,
} from './sheets';
import { loadSheetsConfig } from '../config/sheets';

// Pick gaps that look like a normal Friday→Monday week-over-week pattern.
const HISTORICAL_OFFSETS_DAYS: ReadonlyArray<number> = [-14, -7, -3, -1];

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

const offsetDate = (days: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
};

// Deterministic subset ratio per offset — bigger absolute offset → smaller
// subset (reads as "ramp-up over time"). Range ~50%–80%.
const subsetRatioForOffset = (days: number): number => {
  const abs = Math.abs(days);
  if (abs >= 14) return 0.5;
  if (abs >= 7) return 0.6;
  if (abs >= 3) return 0.7;
  return 0.8;
};

const buildHistoricalTab = (
  today: SheetBuild,
  offsetDays: number,
): SheetBuild | null => {
  const dataRows = today.rows.slice(1); // strip header
  if (dataRows.length === 0) return null;

  const ratio = subsetRatioForOffset(offsetDays);
  const cutoff = Math.max(1, Math.floor(dataRows.length * ratio));
  const tabDate = offsetDate(offsetDays);

  const sliced = dataRows.slice(0, cutoff).map((row) => {
    const newRow = [...row];
    newRow[0] = tabDate; // "Created" column → historical date
    return newRow;
  });
  const slicedTiers = today.tiers.slice(0, cutoff);

  return {
    rows: [HEADER_ROW, ...sliced],
    tiers: slicedTiers,
    summary: {
      tabName: tabDate,
      totalRows: cutoff,
      hot: slicedTiers.filter((t) => t === 'hot').length,
      warm: slicedTiers.filter((t) => t === 'warm').length,
      longTerm: slicedTiers.filter((t) => t === 'long_term').length,
    },
  };
};

export const seedSheetTabs = async (): Promise<{
  written: string[];
  skipped: string[];
  mode: 'live' | 'dry_run';
}> => {
  const today = buildSheetRows();
  if (today.rows.length <= 1) {
    return { written: [], skipped: [], mode: 'dry_run' };
  }

  const config = loadSheetsConfig();
  const mode: 'live' | 'dry_run' = config.configured ? 'live' : 'dry_run';
  const written: string[] = [];
  const skipped: string[] = [];

  for (const offset of HISTORICAL_OFFSETS_DAYS) {
    const build = buildHistoricalTab(today, offset);
    if (!build) {
      skipped.push(offsetDate(offset));
      continue;
    }
    if (config.configured) {
      try {
        await writeToLiveSheet(build, {
          sheetId: config.sheetId,
          credentialsPath: config.credentialsPath,
        });
        written.push(build.summary.tabName);
      } catch (err) {
        console.error(
          `[seed-sheet-tabs] live write failed for tab ${build.summary.tabName}:`,
          err,
        );
        skipped.push(build.summary.tabName);
      }
    } else {
      runDryRun(build);
      written.push(build.summary.tabName);
    }
  }

  return { written, skipped, mode };
};

const isMainModule =
  process.argv[1]?.endsWith('seed-sheet-tabs.ts') ||
  process.argv[1]?.endsWith('seed-sheet-tabs.js');
if (isMainModule) {
  void (async () => {
    const result = await seedSheetTabs();
    if (result.written.length === 0 && result.skipped.length === 0) {
      console.log(
        `[seed-sheet-tabs] no daily_drop rows for today — nothing to seed. Run npm run classify first.`,
      );
      return;
    }
    console.log(
      `[seed-sheet-tabs] mode: ${result.mode} · wrote ${result.written.length} tab${result.written.length === 1 ? '' : 's'}: ${result.written.join(', ')}` +
        (result.skipped.length > 0 ? ` · skipped: ${result.skipped.join(', ')}` : ''),
    );
    if (result.mode === 'dry_run') {
      console.log(
        `\n[seed-sheet-tabs] Set GOOGLE_SHEETS_SHEET_ID + GOOGLE_SHEETS_CREDENTIALS_JSON_PATH in .env to write tabs to the live Sheet.`,
      );
    }
  })();
}
