import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { initDb, normaliseTags, resolveDbPath, type Db } from '../src/db.js';

const opened: Db[] = [];
const dirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notulen-test-'));
  dirs.push(dir);
  return dir;
}

function track(db: Db): Db {
  opened.push(db);
  return db;
}

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  while (dirs.length > 0) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('migration', () => {
  it('opens a real v2 database and keeps every row', () => {
    const file = path.join(tmpDir(), 'v2.db');

    // A v2 database: the exact schema and rows a production install would have.
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE entry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`);
    legacy
      .prepare(
        `INSERT INTO entry (kind, title, body, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('command', 'restart nginx', 'systemctl restart nginx', 'nginx,ops', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
    legacy
      .prepare(
        `INSERT INTO entry (kind, title, body, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run('sop', 'backup check', 'look at the tape', 'backup', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    legacy.close();

    const db = track(initDb(file));

    const rows = db.prepare('SELECT id, kind, title, pinned FROM entry ORDER BY id').all() as {
      id: number;
      kind: string;
      title: string;
      pinned: number;
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.title).toBe('restart nginx');
    expect(rows[1]?.title).toBe('backup check');
    expect(rows.every((row) => row.pinned === 0)).toBe(true);

    const columns = (db.prepare('PRAGMA table_info(entry)').all() as { name: string }[]).map((c) => c.name);
    expect(columns.filter((name) => name === 'pinned')).toHaveLength(1);
  });

  it('is idempotent on a second run', () => {
    const file = path.join(tmpDir(), 'twice.db');

    const first = initDb(file);
    first.prepare(
      `INSERT INTO entry (kind, title, body, tags, pinned, created_at, updated_at)
       VALUES ('task', 'keep me', '', 'x', 1, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    ).run();
    first.close();

    const second = track(initDb(file));
    const columns = (second.prepare('PRAGMA table_info(entry)').all() as { name: string }[]).map((c) => c.name);
    expect(columns.filter((name) => name === 'pinned')).toHaveLength(1);

    const rows = second.prepare('SELECT title, pinned FROM entry').all() as { title: string; pinned: number }[];
    expect(rows).toEqual([{ title: 'keep me', pinned: 1 }]);

    const indexes = (second.prepare('PRAGMA index_list(entry)').all() as { name: string }[]).map((i) => i.name);
    expect(indexes).toContain('idx_entry_created_at');
    expect(indexes).toContain('idx_entry_pinned');
    expect(indexes).toContain('idx_entry_kind');
  });

  it('creates the table from nothing', () => {
    const db = track(initDb(path.join(tmpDir(), 'fresh.db')));
    const columns = (db.prepare('PRAGMA table_info(entry)').all() as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual([
      'id',
      'kind',
      'title',
      'body',
      'tags',
      'pinned',
      'created_at',
      'updated_at',
    ]);
  });
});

describe('resolveDbPath', () => {
  it('honours DB_PATH', () => {
    expect(resolveDbPath({ DB_PATH: '/tmp/custom.db' })).toBe('/tmp/custom.db');
  });

  it('falls back to a local file when DB_PATH is unset and /data is not writable', () => {
    const resolved = resolveDbPath({});
    if (fs.existsSync('/data') && (() => { try { fs.accessSync('/data', fs.constants.W_OK); return true; } catch { return false; } })()) {
      expect(resolved).toBe('/data/notulen.db');
    } else {
      expect(resolved).toBe(path.resolve(process.cwd(), 'notulen.db'));
    }
  });
});

describe('normaliseTags', () => {
  it('trims, lowercases, drops empties and duplicates', () => {
    expect(normaliseTags(' Docker , ops ,, DOCKER ,  ')).toBe('docker,ops');
  });

  it('accepts an array and keeps first-seen order', () => {
    expect(normaliseTags(['Ops', 'ops', ' zfs '])).toBe('ops,zfs');
  });

  it('returns an empty string for nothing', () => {
    expect(normaliseTags(undefined)).toBe('');
    expect(normaliseTags('')).toBe('');
    expect(normaliseTags(' , , ')).toBe('');
  });
});
