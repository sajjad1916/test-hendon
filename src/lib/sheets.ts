// Google Sheets writer (slice 21). The only outbound API in the prototype.
//
// Three layers:
//   1. buildSheetRows()    — pure-ish: queries today's daily_drop joined with
//                            agencies, returns header + N data rows in the
//                            gym-leads 16-column order (PRD line 54).
//   2. runDryRun()         — pretty-prints a preview to stdout. Default mode
//                            when env vars are missing — verifier never makes
//                            a network call.
//   3. writeToLiveSheet()  — only fires when both env vars are present. Auths
//                            via service account, ensures today's tab exists,
//                            writes values, applies tier coloring + freeze
//                            panes + Key Signals wrap.
//
// Direct-execute path: `npm run write-sheet`. Reads daily_drop only — never
// writes to the DB.
//
// PRD line 54 column order:
//   Created · Company · Domain · Reason · Address · Segment · Current Stack ·
//   Phone · Social Links · Email · Owner/People · Key Signals · Country ·
//   Priority Tier · Notes · Salesperson

import { google, type sheets_v4 } from 'googleapis';
import { db } from '../db';
import { loadSheetsConfig, type SheetsConfig } from '../config/sheets';

// ── Types ────────────────────────────────────────────────────────────────

export type Tier = 'hot' | 'warm' | 'long_term';

interface DropRow {
  drop_id: number;
  agency_id: number;
  drop_date: string;
  tier: Tier;
  reason: string | null;
  key_signals: string | null;
  // agency fields
  name: string;
  domain: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  owner_first_name: string | null;
  owner_last_name: string | null;
  segment: string | null;
}

export interface SheetSummary {
  tabName: string;
  totalRows: number;
  hot: number;
  warm: number;
  longTerm: number;
}

export interface SheetBuild {
  rows: string[][];      // header + data
  tiers: Tier[];         // length = rows.length - 1; aligned with data rows
  summary: SheetSummary;
}

export const HEADER_ROW: string[] = [
  'Created',
  'Company',
  'Domain',
  'Reason',
  'Address',
  'Segment',
  'Current Stack',
  'Phone',
  'Social Links',
  'Email',
  'Owner/People',
  'Key Signals',
  'Country',
  'Priority Tier',
  'Notes',
  'Salesperson',
];

const KEY_SIGNALS_COLUMN_INDEX = 11; // zero-based

// ── Layer 1: buildSheetRows ──────────────────────────────────────────────

const fetchTodayDropStmt = db.prepare(`
  SELECT
    d.id           AS drop_id,
    d.agency_id    AS agency_id,
    d.drop_date    AS drop_date,
    d.tier         AS tier,
    d.reason       AS reason,
    d.key_signals  AS key_signals,
    a.name         AS name,
    a.domain       AS domain,
    a.street       AS street,
    a.city         AS city,
    a.state        AS state,
    a.zip          AS zip,
    a.country      AS country,
    a.phone        AS phone,
    a.email        AS email,
    a.owner_first_name AS owner_first_name,
    a.owner_last_name  AS owner_last_name,
    a.segment      AS segment
  FROM daily_drop d
  JOIN agencies a ON a.id = d.agency_id
  WHERE d.drop_date = date('now')
  ORDER BY
    CASE d.tier
      WHEN 'hot' THEN 1
      WHEN 'warm' THEN 2
      WHEN 'long_term' THEN 3
      ELSE 4
    END,
    a.id
`);

const todayTabName = (): string => {
  // SQLite's date('now') uses UTC; match it so the tab name matches drop_date.
  const now = new Date();
  const yyyy = String(now.getUTCFullYear()).padStart(4, '0');
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatAddress = (
  street: string | null,
  city: string | null,
  state: string | null,
  zip: string | null,
): string => {
  // "street, city, state zip"; gracefully skip blanks so we don't render
  // ", , NY 10001" or stray commas.
  const head = [street, city].map((s) => (s ?? '').trim()).filter(Boolean).join(', ');
  const tail = [state, zip].map((s) => (s ?? '').trim()).filter(Boolean).join(' ');
  return [head, tail].filter(Boolean).join(', ');
};

const formatOwner = (
  first: string | null,
  last: string | null,
): string => {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  return [f, l].filter(Boolean).join(' ');
};

const formatTier = (tier: Tier): string => {
  if (tier === 'hot') return 'Hot';
  if (tier === 'warm') return 'Warm';
  return 'Long-term';
};

const formatKeySignals = (raw: string | null): string => {
  // key_signals is stored as plain newline-separated text (slice 18). Sheets
  // preserves \n in cells when valueInputOption is USER_ENTERED + WRAP.
  return (raw ?? '').trim();
};

export const buildSheetRows = (): SheetBuild => {
  const dropRows = fetchTodayDropStmt.all() as DropRow[];
  const tabName = todayTabName();

  const data: string[][] = [];
  const tiers: Tier[] = [];
  let hot = 0;
  let warm = 0;
  let longTerm = 0;

  for (const r of dropRows) {
    if (r.tier === 'hot') hot++;
    else if (r.tier === 'warm') warm++;
    else if (r.tier === 'long_term') longTerm++;

    tiers.push(r.tier);

    data.push([
      r.drop_date,                                                   // Created
      r.name,                                                        // Company
      r.domain ?? '',                                                // Domain
      r.reason ?? '',                                                // Reason
      formatAddress(r.street, r.city, r.state, r.zip),               // Address
      r.segment ?? '',                                               // Segment
      '',                                                            // Current Stack
      r.phone ?? '',                                                 // Phone
      // TODO: pull from agencies.metadata once LinkedIn URLs are persisted
      '',                                                            // Social Links
      r.email ?? '',                                                 // Email
      formatOwner(r.owner_first_name, r.owner_last_name),            // Owner/People
      formatKeySignals(r.key_signals),                               // Key Signals
      r.country ?? 'US',                                             // Country
      formatTier(r.tier),                                            // Priority Tier
      '',                                                            // Notes
      '',                                                            // Salesperson
    ]);
  }

  return {
    rows: [HEADER_ROW, ...data],
    tiers,
    summary: {
      tabName,
      totalRows: data.length,
      hot,
      warm,
      longTerm,
    },
  };
};

// ── Layer 2: runDryRun ───────────────────────────────────────────────────

const truncate = (s: string, max: number): string => {
  // Collapse any newlines so the preview table stays one row per record.
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return flat.slice(0, Math.max(0, max - 1)) + '…';
};

export const runDryRun = (build: SheetBuild): void => {
  const { summary, rows } = build;
  console.log('[sheets] DRY RUN — no network calls made.');
  console.log(
    `[sheets] tab "${summary.tabName}" · ${summary.totalRows} data row${summary.totalRows === 1 ? '' : 's'}` +
      ` (hot=${summary.hot}, warm=${summary.warm}, long_term=${summary.longTerm})`,
  );

  // Preview the first ~5 data rows in a column-aligned table. We pick a
  // narrow subset of columns that make the most sense in a CLI preview;
  // the full 16-column row is what would be written to the Sheet.
  const previewCols: Array<{ idx: number; label: string; width: number }> = [
    { idx: 0,  label: 'Created',    width: 10 },
    { idx: 1,  label: 'Company',    width: 28 },
    { idx: 13, label: 'Tier',       width: 10 },
    { idx: 3,  label: 'Reason',     width: 50 },
    { idx: 4,  label: 'Address',    width: 30 },
  ];

  const header = previewCols
    .map((c) => c.label.padEnd(c.width))
    .join('  ');
  const sep = previewCols
    .map((c) => '-'.repeat(c.width))
    .join('  ');

  console.log('');
  console.log(`[sheets] preview (first 5 of ${summary.totalRows}):`);
  console.log('  ' + header);
  console.log('  ' + sep);

  const previewCount = Math.min(5, summary.totalRows);
  for (let i = 1; i <= previewCount; i++) {
    const row = rows[i];
    if (!row) break;
    const line = previewCols
      .map((c) => truncate(row[c.idx] ?? '', c.width).padEnd(c.width))
      .join('  ');
    console.log('  ' + line);
  }
  if (summary.totalRows > previewCount) {
    console.log(`  … (${summary.totalRows - previewCount} more)`);
  }
  console.log('');
  console.log(
    '[sheets] Set GOOGLE_SHEETS_SHEET_ID and GOOGLE_SHEETS_CREDENTIALS_JSON_PATH in .env to write live.',
  );
};

// ── Layer 3: writeToLiveSheet ────────────────────────────────────────────

interface LiveConfig {
  sheetId: string;
  credentialsPath: string;
}

const TIER_COLORS: Record<Tier, sheets_v4.Schema$Color> = {
  // Soft amber
  hot:       { red: 1.0,  green: 0.93, blue: 0.7 },
  // Brand teal at low opacity-equivalent
  warm:      { red: 0.86, green: 0.96, blue: 0.94 },
  // Soft slate
  long_term: { red: 0.95, green: 0.96, blue: 0.97 },
};

const ensureTab = async (
  sheets: sheets_v4.Sheets,
  spreadsheetId: string,
  tabName: string,
): Promise<number> => {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === tabName,
  );
  if (existing?.properties?.sheetId != null) {
    // Tab already exists — clear values so we re-write cleanly.
    await sheets.spreadsheets.values.clear({
      spreadsheetId,
      range: `${tabName}!A1:ZZ`,
    });
    return existing.properties.sheetId;
  }
  // Add new tab.
  const add = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: tabName,
              gridProperties: { rowCount: 1000, columnCount: 26 },
            },
          },
        },
      ],
    },
  });
  const sheetId = add.data.replies?.[0]?.addSheet?.properties?.sheetId;
  if (sheetId == null) {
    throw new Error(`[sheets] failed to add tab "${tabName}" — no sheetId in response`);
  }
  return sheetId;
};

const buildFormatRequests = (
  sheetId: number,
  tiers: Tier[],
): sheets_v4.Schema$Request[] => {
  const reqs: sheets_v4.Schema$Request[] = [];

  // 1. Freeze first row + first column.
  reqs.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount',
    },
  });

  // 2. Wrap text on the Key Signals column (skip header row).
  reqs.push({
    repeatCell: {
      range: {
        sheetId,
        startRowIndex: 1,
        startColumnIndex: KEY_SIGNALS_COLUMN_INDEX,
        endColumnIndex: KEY_SIGNALS_COLUMN_INDEX + 1,
      },
      cell: {
        userEnteredFormat: { wrapStrategy: 'WRAP' },
      },
      fields: 'userEnteredFormat.wrapStrategy',
    },
  });

  // 3. Tier-based row coloring. tiers[i] corresponds to data row i, which
  // sits at sheet row index i + 1 (after the header).
  for (let i = 0; i < tiers.length; i++) {
    const tier = tiers[i];
    if (!tier) continue;
    const color = TIER_COLORS[tier];
    reqs.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: i + 1,
          endRowIndex: i + 2,
          startColumnIndex: 0,
          endColumnIndex: HEADER_ROW.length,
        },
        cell: {
          userEnteredFormat: { backgroundColor: color },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  return reqs;
};

export const writeToLiveSheet = async (
  build: SheetBuild,
  config: LiveConfig,
): Promise<void> => {
  let sheets: sheets_v4.Sheets;
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.credentialsPath,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheets = google.sheets({ version: 'v4', auth });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(
      `[sheets] auth failed (check GOOGLE_SHEETS_CREDENTIALS_JSON_PATH=${config.credentialsPath}): ${msg}`,
    );
  }

  const tabName = build.summary.tabName;
  const sheetId = await ensureTab(sheets, config.sheetId, tabName);

  // Write values.
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: build.rows },
  });

  // Apply formatting (freeze panes, wrap, tier colors).
  const requests = buildFormatRequests(sheetId, build.tiers);
  if (requests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: { requests },
    });
  }
};

// ── Direct-execute path (npm run write-sheet) ────────────────────────────

const run = async (): Promise<void> => {
  const config: SheetsConfig = loadSheetsConfig();
  const build = buildSheetRows();

  if (build.summary.totalRows === 0) {
    console.log(
      "[sheets] no daily_drop rows for today (date('now')). Run npm run classify first.",
    );
    return;
  }

  if (!config.configured) {
    console.log(
      `[sheets] running in DRY-RUN mode — missing env vars: ${config.missing.join(', ')}`,
    );
    runDryRun(build);
    return;
  }

  console.log(
    `[sheets] LIVE mode — writing tab "${build.summary.tabName}" to spreadsheet ${config.sheetId}`,
  );
  await writeToLiveSheet(build, {
    sheetId: config.sheetId,
    credentialsPath: config.credentialsPath,
  });
  console.log(
    `[sheets] wrote ${build.summary.totalRows} row${build.summary.totalRows === 1 ? '' : 's'}` +
      ` (hot=${build.summary.hot}, warm=${build.summary.warm}, long_term=${build.summary.longTerm})`,
  );
};

const isMainModule =
  process.argv[1]?.endsWith('sheets.ts') ||
  process.argv[1]?.endsWith('sheets.js');
if (isMainModule) {
  run().catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sheets] failed: ${msg}`);
    process.exitCode = 1;
  });
}
