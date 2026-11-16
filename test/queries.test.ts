import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initDb, type Db } from '../src/db.js';
import {
  createEntry,
  deleteEntry,
  getEntry,
  listEntries,
  listTags,
  togglePin,
  updateEntry,
} from '../src/queries.js';

let db: Db;

beforeEach(() => {
  db = initDb(':memory:');
});

afterEach(() => {
  db.close();
});

function seed(): void {
  createEntry(db, {
    kind: 'task',
    title: 'docker cleanup',
    body: 'prune the images',
    tags: 'ops',
  });
  createEntry(db, {
    kind: 'command',
    title: 'restart the box',
    body: 'systemctl restart',
    tags: 'docker,compose',
  });
  createEntry(db, {
    kind: 'sop',
    title: 'weekly backup',
    body: 'check docker and tapes',
    tags: 'backup',
  });
}

describe('ranked search', () => {
  it('orders title matches before tag matches before body matches', () => {
    seed();
    const results = listEntries(db, { q: 'docker' });
    expect(results.map((entry) => entry.title)).toEqual([
      'docker cleanup', // title
      'restart the box', // tag
      'weekly backup', // body
    ]);
  });

  it('keeps pinned entries above better-ranked ones', () => {
    seed();
    const body = listEntries(db, { q: 'docker' })[2];
    if (!body) throw new Error('expected a third result');
    togglePin(db, body.id);

    const results = listEntries(db, { q: 'docker' });
    expect(results[0]?.title).toBe('weekly backup');
    expect(results[0]?.pinned).toBe(1);
  });

  it('breaks ties by created_at DESC then id DESC', () => {
    const a = createEntry(db, { kind: 'task', title: 'same', body: '', tags: '' });
    const b = createEntry(db, { kind: 'task', title: 'same', body: '', tags: '' });
    db.prepare('UPDATE entry SET created_at = ? WHERE id IN (?, ?)').run('2026-01-01T00:00:00Z', a.id, b.id);

    const results = listEntries(db, { q: 'same' });
    expect(results.map((entry) => entry.id)).toEqual([b.id, a.id]);
  });

  it('returns everything when q is empty', () => {
    seed();
    expect(listEntries(db, { q: '   ' })).toHaveLength(3);
  });

  it('treats % as a literal, not a wildcard', () => {
    createEntry(db, { kind: 'task', title: 'disk at 100%', body: '', tags: '' });
    createEntry(db, { kind: 'task', title: 'unrelated', body: '', tags: '' });
    const results = listEntries(db, { q: '100%' });
    expect(results.map((entry) => entry.title)).toEqual(['disk at 100%']);
  });
});

describe('tag filter', () => {
  it('matches a whole tag only', () => {
    createEntry(db, { kind: 'task', title: 'a', body: '', tags: 'docker' });
    createEntry(db, { kind: 'task', title: 'b', body: '', tags: 'dockers' });
    createEntry(db, { kind: 'task', title: 'c', body: '', tags: 'ops,docker' });

    const results = listEntries(db, { tag: 'docker' });
    expect(results.map((entry) => entry.title).sort()).toEqual(['a', 'c']);
  });

  it('normalises the filter value too', () => {
    createEntry(db, { kind: 'task', title: 'a', body: '', tags: 'Docker' });
    expect(listEntries(db, { tag: ' DOCKER ' })).toHaveLength(1);
  });
});

describe('filters', () => {
  it('filters by kind', () => {
    seed();
    expect(listEntries(db, { kind: 'command' }).map((entry) => entry.title)).toEqual(['restart the box']);
  });

  it('filters pinned only', () => {
    seed();
    const first = listEntries(db, {})[0];
    if (!first) throw new Error('expected a row');
    togglePin(db, first.id);
    expect(listEntries(db, { pinned: true }).map((entry) => entry.id)).toEqual([first.id]);
  });

  it('honours limit and offset', () => {
    seed();
    const all = listEntries(db, {});
    const page = listEntries(db, { limit: 1, offset: 1 });
    expect(page).toHaveLength(1);
    expect(page[0]?.id).toBe(all[1]?.id);
  });
});

describe('writes', () => {
  it('normalises tags on create', () => {
    const entry = createEntry(db, { kind: 'task', title: 'x', tags: ' Ops , ops , Docker ' });
    expect(entry.tags).toBe('ops,docker');
  });

  it('updates only the fields given and bumps updated_at', () => {
    const entry = createEntry(db, { kind: 'task', title: 'x', body: 'keep', tags: 'a' });
    const updated = updateEntry(db, entry.id, { title: 'y' });
    expect(updated?.title).toBe('y');
    expect(updated?.body).toBe('keep');
    expect(updated?.tags).toBe('a');
    expect(updated?.updated_at >= entry.updated_at).toBe(true);
  });

  it('returns undefined when updating a missing row', () => {
    expect(updateEntry(db, 999, { title: 'nope' })).toBeUndefined();
  });

  it('toggles pin both ways without touching updated_at', () => {
    const entry = createEntry(db, { kind: 'task', title: 'x' });
    const pinned = togglePin(db, entry.id);
    expect(pinned?.pinned).toBe(1);
    expect(pinned?.updated_at).toBe(entry.updated_at);

    const unpinned = togglePin(db, entry.id);
    expect(unpinned?.pinned).toBe(0);
    expect(togglePin(db, 999)).toBeUndefined();
  });

  it('deletes and reports whether a row went', () => {
    const entry = createEntry(db, { kind: 'task', title: 'x' });
    expect(deleteEntry(db, entry.id)).toBe(true);
    expect(deleteEntry(db, entry.id)).toBe(false);
    expect(getEntry(db, entry.id)).toBeUndefined();
  });
});

describe('listTags', () => {
  it('counts each tag across rows, most used first', () => {
    seed();
    const tags = listTags(db);
    expect(tags).toEqual([
      { tag: 'backup', count: 1 },
      { tag: 'compose', count: 1 },
      { tag: 'docker', count: 1 },
      { tag: 'ops', count: 1 },
    ]);

    createEntry(db, { kind: 'task', title: 'more docker', tags: 'docker' });
    expect(listTags(db)[0]).toEqual({ tag: 'docker', count: 2 });
  });

  it('ignores rows with no tags', () => {
    createEntry(db, { kind: 'task', title: 'bare' });
    expect(listTags(db)).toEqual([]);
  });
});
