import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DEFAULT_DB_PATH = './hendon.sqlite';
const MIGRATIONS_DIR = join(process.cwd(), 'src/db/migrations');

const dbPath = process.env.DATABASE_PATH ?? DEFAULT_DB_PATH;

export const db: Database.Database = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const applied = new Set(
  (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(
    (r) => r.name,
  ),
);

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const apply = db.transaction((name: string, sql: string) => {
  db.exec(sql);
  db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(name);
});

for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');
  apply(file, sql);
  console.log(`[db] applied migration ${file}`);
}

console.log(`[db] ready at ${dbPath}`);
