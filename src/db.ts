import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

/**
 * DB_PATH wins. Otherwise /data/notulen.db, which is the container path.
 * If /data is missing or not writable we are on a dev machine, so ./notulen.db.
 */
export function resolveDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.DB_PATH?.trim();
  if (explicit) return path.resolve(explicit);

  try {
    fs.accessSync('/data', fs.constants.W_OK);
    return '/data/notulen.db';
  } catch {
    return path.resolve(process.cwd(), 'notulen.db');
  }
}

const CREATE_ENTRY = `
CREATE TABLE IF NOT EXISTS entry (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  tags       TEXT NOT NULL DEFAULT '',
  pinned     INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

/**
 * A v1 or v2 database predates `pinned`, so CREATE TABLE IF NOT EXISTS leaves it
 * alone and we add the column here. Idempotent: checked by name, not by try/catch,
 * so a second run is a no-op and never duplicates the column.
 */
function migrate(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(entry)').all() as { name: string }[];
  const hasPinned = columns.some((column) => column.name === 'pinned');
  if (!hasPinned) {
    db.exec('ALTER TABLE entry ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  }
}

function createIndexes(db: Db): void {
  db.exec('CREATE INDEX IF NOT EXISTS idx_entry_created_at ON entry (created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_entry_pinned ON entry (pinned)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_entry_kind ON entry (kind)');
}

export function initDb(dbPath: string = resolveDbPath()): Db {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(CREATE_ENTRY);
  migrate(db);
  createIndexes(db);
  return db;
}

/**
 * trim, lowercase, drop empties, drop duplicates, keep first-seen order, join with ",".
 * Accepts a comma separated string or an array, because the API and the form disagree
 * about which one they send.
 */
export function normaliseTags(input: string | readonly string[] | null | undefined): string {
  if (input === null || input === undefined) return '';
  const parts = typeof input === 'string' ? input.split(',') : [...input];
  const seen = new Set<string>();
  for (const raw of parts) {
    const tag = String(raw).trim().toLowerCase();
    if (tag === '') continue;
    seen.add(tag);
  }
  return [...seen].join(',');
}
