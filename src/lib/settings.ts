// Tight, reusable typed helpers around the `settings` (key, value) table.
// All setters UPSERT and bump `updated_at`. Boolean storage convention:
// strings 'true' / 'false' so they round-trip through JSON dumps and the
// existing migration-seeded values stay readable.

import { db } from '../db';

const selectStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertStmt = db.prepare(
  `INSERT INTO settings (key, value, updated_at)
   VALUES (?, ?, datetime('now'))
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
);

export const getRaw = (key: string): string | undefined => {
  const row = selectStmt.get(key) as { value: string } | undefined;
  return row?.value;
};

export const setRaw = (key: string, value: string): void => {
  upsertStmt.run(key, value);
};

export const getJson = <T>(key: string, fallback: T): T => {
  const raw = getRaw(key);
  if (raw === undefined) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

export const setJson = (key: string, value: unknown): void => {
  setRaw(key, JSON.stringify(value));
};

export const getNumber = (key: string, fallback: number): number => {
  const raw = getRaw(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const setNumber = (key: string, n: number): void => {
  setRaw(key, String(n));
};

export const getBoolean = (key: string, fallback: boolean): boolean => {
  const raw = getRaw(key);
  if (raw === undefined) return fallback;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
};

export const setBoolean = (key: string, b: boolean): void => {
  setRaw(key, b ? 'true' : 'false');
};

// INSERT OR IGNORE — used by routes that introduce new keys without a migration
// round-trip (e.g. slice 19 introduces `output.*`, `ai.narrative_enabled`, and
// `dedup.long_term_floor_enabled`).
const insertIfMissingStmt = db.prepare(
  `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
);

export const seedRawIfMissing = (key: string, value: string): void => {
  insertIfMissingStmt.run(key, value);
};
