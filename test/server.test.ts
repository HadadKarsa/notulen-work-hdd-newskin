import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { initDb, type Db } from '../src/db.js';
import { buildServer } from '../src/server.js';

let db: Db;
let app: FastifyInstance;

beforeEach(async () => {
  db = initDb(':memory:');
  app = buildServer({ db });
  await app.ready();
});

afterEach(async () => {
  await app.close();
  db.close();
});

describe('health', () => {
  it('answers 200 JSON on both paths', async () => {
    for (const url of ['/health', '/api/health']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toEqual({ status: 'ok' });
    }
  });

  it('does not touch the database', async () => {
    const broken = new Proxy({} as Db, {
      get() {
        throw new Error('database was touched');
      },
    });
    const cold = buildServer({ db: broken });
    await cold.ready();
    const response = await cold.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await cold.close();
  });
});

describe('html routes', () => {
  it('renders the list, an entry and the tag page as HTML', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/entries',
      payload: { kind: 'task', title: 'first note', body: 'hello', tags: 'ops' },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as number;

    const list = await app.inject({ method: 'GET', url: '/' });
    expect(list.statusCode).toBe(200);
    expect(list.headers['content-type']).toContain('text/html');
    expect(list.body).toContain('first note');

    const one = await app.inject({ method: 'GET', url: `/entry/${id}` });
    expect(one.statusCode).toBe(200);
    expect(one.headers['content-type']).toContain('text/html');
    expect(one.body).toContain('first note');

    const tags = await app.inject({ method: 'GET', url: '/tags' });
    expect(tags.statusCode).toBe(200);
    expect(tags.body).toContain('ops');
  });

  it('escapes raw HTML in a note body', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/entries',
      payload: { kind: 'task', title: 'xss', body: '<script>alert(1)</script>' },
    });
    const id = created.json().id as number;
    const one = await app.inject({ method: 'GET', url: `/entry/${id}` });
    expect(one.body).not.toContain('<script>alert(1)</script>');
  });

  it('answers 400 HTML for a non-numeric id', async () => {
    const response = await app.inject({ method: 'GET', url: '/entry/abc' });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('must be a number');
  });

  it('answers 404 HTML for a missing entry', async () => {
    const response = await app.inject({ method: 'GET', url: '/entry/999' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/html');
  });

  it('answers 404 HTML for an unknown path', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).not.toContain('"statusCode"');
  });

  it('answers /admin with the dashboard build or the placeholder', async () => {
    const response = await app.inject({ method: 'GET', url: '/admin' });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    // public/admin is a build artifact and gitignored, so both states are valid here:
    // the Vite bundle when it has been built, the Indonesian placeholder when it has not.
    expect(response.body).toMatch(/id="root"|Dasbor belum dibangun/);
  });
});

describe('json api', () => {
  it('creates, reads, patches, pins and deletes', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/entries',
      payload: { kind: 'command', title: 'restart nginx', body: 'systemctl restart nginx', tags: ['Ops', 'ops'] },
    });
    expect(created.statusCode).toBe(201);
    const entry = created.json();
    expect(entry.tags).toBe('ops');

    const list = await app.inject({ method: 'GET', url: '/api/entries' });
    expect(list.json().entries).toHaveLength(1);
    expect(list.json().entries[0]).not.toHaveProperty('rank');

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/entries/${entry.id}`,
      payload: { title: 'restart nginx now' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().title).toBe('restart nginx now');

    const pinned = await app.inject({ method: 'POST', url: `/api/entries/${entry.id}/pin` });
    expect(pinned.json().pinned).toBe(1);

    const removed = await app.inject({ method: 'DELETE', url: `/api/entries/${entry.id}` });
    expect(removed.statusCode).toBe(204);

    const gone = await app.inject({ method: 'GET', url: `/api/entries/${entry.id}` });
    expect(gone.statusCode).toBe(404);
  });

  it('returns tags with counts', async () => {
    await app.inject({ method: 'POST', url: '/api/entries', payload: { kind: 'task', title: 'a', tags: 'x,y' } });
    const response = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(response.json()).toEqual({
      tags: [
        { tag: 'x', count: 1 },
        { tag: 'y', count: 1 },
      ],
    });
  });

  it('answers 400 JSON for an invalid kind', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/entries',
      payload: { kind: 'recipe', title: 'nope' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.json().error).toContain('kind must be one of');
  });

  it('answers 400 JSON for a non-numeric id', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/entries/abc' });
    expect(response.statusCode).toBe(400);
    expect(response.json().statusCode).toBe(400);
  });

  it('answers 404 JSON for a missing entry', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/entries/999' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('answers 404 JSON for an unknown api path', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.headers['content-type']).toContain('application/json');
  });

  it('answers 500 JSON without a stack trace when the database fails', async () => {
    const broken = new Proxy({} as Db, {
      get() {
        throw new Error('disk on fire at /data/notulen.db');
      },
    });
    const failing = buildServer({ db: broken });
    await failing.ready();

    const response = await failing.inject({ method: 'GET', url: '/api/entries' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('application/json');
    expect(response.body).not.toContain('disk on fire');
    expect(response.body).not.toContain('at /data');
    expect(response.json()).toEqual({ error: 'Something went wrong on the server.', statusCode: 500 });

    await failing.close();
  });

  it('answers 500 HTML without a stack trace on a page route', async () => {
    const broken = new Proxy({} as Db, {
      get() {
        throw new Error('disk on fire at /data/notulen.db');
      },
    });
    const failing = buildServer({ db: broken });
    await failing.ready();

    const response = await failing.inject({ method: 'GET', url: '/' });
    expect(response.statusCode).toBe(500);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).not.toContain('disk on fire');

    await failing.close();
  });
});
