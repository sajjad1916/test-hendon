// Google Sheets writer config (slice 21).
//
// Reads two env vars:
//   GOOGLE_SHEETS_SHEET_ID                — the demo Sheet's spreadsheetId
//   GOOGLE_SHEETS_CREDENTIALS_JSON_PATH   — path to a service-account key file
//
// If either is missing we return a `configured: false` result with the list of
// missing keys so the caller can fall through to dry-run mode. We deliberately
// don't crack open the credentials JSON here — `loadSheetsConfig()` is cheap,
// pure, and side-effect-free; auth happens lazily inside `writeToLiveSheet`.
//
// Keep this the only place that reads `process.env.GOOGLE_SHEETS_*`.

export type SheetsConfigKey = 'sheetId' | 'credentialsPath';

export type SheetsConfig =
  | { configured: true; sheetId: string; credentialsPath: string }
  | { configured: false; missing: SheetsConfigKey[] };

export const loadSheetsConfig = (): SheetsConfig => {
  const sheetId = process.env.GOOGLE_SHEETS_SHEET_ID?.trim() ?? '';
  const credentialsPath =
    process.env.GOOGLE_SHEETS_CREDENTIALS_JSON_PATH?.trim() ?? '';

  const missing: SheetsConfigKey[] = [];
  if (!sheetId) missing.push('sheetId');
  if (!credentialsPath) missing.push('credentialsPath');

  if (missing.length > 0) {
    return { configured: false, missing };
  }
  return { configured: true, sheetId, credentialsPath };
};
