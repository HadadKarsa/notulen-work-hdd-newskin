import { normaliseTags, type Db } from './db.js';

export const KINDS = ['task', 'tutorial', 'command', 'sop', 'workflow', 'meeting'] as const;
export type Kind = (typeof KINDS)[number];

export function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

export interface Entry {
  id: number;
  kind: Kind;
  title: string;
  body: string;
  tags: string;
  pinned: number;
  created_at: string;
  updated_at: string;
  /** present only on rows coming back from listEntries; the API strips it */
  rank?: number;
}

export interface ListParams {
  kind?: string;
  tag?: string;
  q?: string;
  pinned?: boolean;
  limit?: number;
  offset?: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

const COLUMNS = 'id, kind, title, body, tags, pinned, created_at, updated_at';

/** LIKE treats % and _ as wildcards; a note about "100%" must not match everything. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function whereClause(params: ListParams): { sql: string; bind: Record<string, unknown> } {
  const clauses: string[] = [];
  const bind: Record<string, unknown> = {};

  if (params.kind) {
    clauses.push('kind = @kind');
    bind.kind = params.kind;
  }
  if (params.tag) {
    // exact tag, never substring: dockers must not match docker
    clauses.push("instr(',' || tags || ',', ',' || @tag || ',') > 0");
    bind.tag = normaliseTags(params.tag);
  }
  if (params.pinned) {
    clauses.push('pinned = 1');
  }
  if (params.q && params.q.trim() !== '') {
    clauses.push("(title LIKE @like ESCAPE '\\' OR tags LIKE @like ESCAPE '\\' OR body LIKE @like ESCAPE '\\')");
    bind.like = `%${escapeLike(params.q.trim())}%`;
  }

  return { sql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', bind };
}

export function listEntries(db: Db, params: ListParams = {}): Entry[] {
  const { sql: where, bind } = whereClause(params);
  const searching = Boolean(params.q && params.q.trim() !== '');
  const limit = clampInt(params.limit, 50, 1, 500);
  const offset = clampInt(params.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  // The rank expression is the whole search: title beats tag beats body, and a row
  // that only matched by falling through still sorts last rather than disappearing.
  const rank = searching
    ? "CASE WHEN title LIKE @like ESCAPE '\\' THEN 0 WHEN tags LIKE @like ESCAPE '\\' THEN 1 WHEN body LIKE @like ESCAPE '\\' THEN 2 ELSE 3 END AS rank"
    : '0 AS rank';

  const statement = `
    SELECT ${COLUMNS}, ${rank}
    FROM entry
    ${where}
    ORDER BY pinned DESC, rank, created_at DESC, id DESC
    LIMIT @limit OFFSET @offset`;

  return db.prepare(statement).all({ ...bind, limit, offset }) as Entry[];
}

export function getEntry(db: Db, id: number): Entry | undefined {
  return db.prepare(`SELECT ${COLUMNS} FROM entry WHERE id = ?`).get(id) as Entry | undefined;
}

export interface CreateInput {
  kind: Kind;
  title: string;
  body?: string;
  tags?: string | readonly string[];
  pinned?: boolean;
}

export function createEntry(db: Db, input: CreateInput): Entry {
  const now = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO entry (kind, title, body, tags, pinned, created_at, updated_at)
       VALUES (@kind, @title, @body, @tags, @pinned, @created_at, @updated_at)`,
    )
    .run({
      kind: input.kind,
      title: input.title,
      body: input.body ?? '',
      tags: normaliseTags(input.tags),
      pinned: input.pinned ? 1 : 0,
      created_at: now,
      updated_at: now,
    });
  return getEntry(db, Number(info.lastInsertRowid)) as Entry;
}

export interface UpdateInput {
  kind?: Kind;
  title?: string;
  body?: string;
  tags?: string | readonly string[];
  pinned?: boolean;
}

/** Returns undefined when the row does not exist, so the caller can answer 404. */
export function updateEntry(db: Db, id: number, input: UpdateInput): Entry | undefined {
  const sets: string[] = [];
  const bind: Record<string, unknown> = { id };

  if (input.kind !== undefined) {
    sets.push('kind = @kind');
    bind.kind = input.kind;
  }
  if (input.title !== undefined) {
    sets.push('title = @title');
    bind.title = input.title;
  }
  if (input.body !== undefined) {
    sets.push('body = @body');
    bind.body = input.body;
  }
  if (input.tags !== undefined) {
    sets.push('tags = @tags');
    bind.tags = normaliseTags(input.tags);
  }
  if (input.pinned !== undefined) {
    sets.push('pinned = @pinned');
    bind.pinned = input.pinned ? 1 : 0;
  }

  if (sets.length === 0) return getEntry(db, id);

  sets.push('updated_at = @updated_at');
  bind.updated_at = new Date().toISOString();

  const info = db.prepare(`UPDATE entry SET ${sets.join(', ')} WHERE id = @id`).run(bind);
  if (info.changes === 0) return undefined;
  return getEntry(db, id);
}

export function deleteEntry(db: Db, id: number): boolean {
  return db.prepare('DELETE FROM entry WHERE id = ?').run(id).changes > 0;
}

/**
 * Toggle, not set. updated_at is left alone on purpose: pinning is a filing decision,
 * not an edit, and the list shows updated_at as "last changed".
 */
export function togglePin(db: Db, id: number): Entry | undefined {
  const info = db
    .prepare('UPDATE entry SET pinned = CASE pinned WHEN 0 THEN 1 ELSE 0 END WHERE id = ?')
    .run(id);
  if (info.changes === 0) return undefined;
  return getEntry(db, id);
}

/**
 * tags is a comma separated column, so counting means splitting it. A recursive CTE
 * keeps this one statement instead of pulling every row into JS.
 */
export function listTags(db: Db): TagCount[] {
  const statement = `
    WITH RECURSIVE
      src(id, tags) AS (
        SELECT id, tags FROM entry WHERE tags <> ''
      ),
      split(id, tag, rest) AS (
        SELECT id,
               substr(tags, 1, instr(tags || ',', ',') - 1),
               substr(tags || ',', instr(tags || ',', ',') + 1)
        FROM src
        UNION ALL
        SELECT id,
               substr(rest, 1, instr(rest, ',') - 1),
               substr(rest, instr(rest, ',') + 1)
        FROM split
        WHERE rest <> ''
      )
    SELECT tag, COUNT(*) AS count
    FROM split
    WHERE tag <> ''
    GROUP BY tag
    ORDER BY count DESC, tag ASC`;
  return db.prepare(statement).all() as TagCount[];
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < min) return min;
  if (rounded > max) return max;
  return rounded;
}
