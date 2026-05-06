// Thin wrapper around csv-parse/sync with the prototype's intentional
// constraints: UTF-8 only, BOM-aware, comma-delimited, skip empty lines,
// relax mismatched column counts (we'll surface them as row-level errors
// later rather than blowing up the whole parse). Production hardening
// (Latin-1 / Windows-1252 detection, semicolon/pipe delimiters,
// async streaming) is explicitly out of prototype scope.

import { parse as parseCsvSync } from 'csv-parse/sync';

export interface ParsedCsv {
  headers: string[];
  rows: string[][];
  parseErrors: string[];
}

const stripBom = (s: string): string =>
  s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;

export const parseCsv = (input: Buffer | string): ParsedCsv => {
  const text =
    typeof input === 'string' ? input : input.toString('utf-8');
  const cleaned = stripBom(text);

  if (cleaned.trim().length === 0) {
    return {
      headers: [],
      rows: [],
      parseErrors: ['Empty file (no content after stripping whitespace + BOM)'],
    };
  }

  let records: string[][];
  try {
    records = parseCsvSync(cleaned, {
      delimiter: ',',
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
      columns: false,
    }) as string[][];
  } catch (e) {
    return {
      headers: [],
      rows: [],
      parseErrors: [`Parse failed: ${(e as Error).message}`],
    };
  }

  if (records.length === 0) {
    return {
      headers: [],
      rows: [],
      parseErrors: ['No rows found in file'],
    };
  }

  const [headerRow, ...dataRows] = records;
  if (!headerRow || headerRow.length === 0) {
    return {
      headers: [],
      rows: [],
      parseErrors: ['Missing header row'],
    };
  }

  return { headers: headerRow, rows: dataRows, parseErrors: [] };
};
