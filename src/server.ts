import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import { initDb, resolveDbPath, type Db } from './db.js';
import {
  createEntry,
  deleteEntry,
  getEntry,
  isKind,
  listEntries,
  listTags,
  togglePin,
  updateEntry,
  type Entry,
  type ListParams,
} from './queries.js';
import { renderAdminPlaceholder, renderEntry, renderError, renderList, renderTags } from './render.js';
import { registerAdminGuard } from './guard.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');
const publicDir = path.join(projectRoot, 'public');

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function wantsJson(request: FastifyRequest): boolean {
  return request.url.startsWith('/api/') || request.url === '/api';
}

function parseId(raw: string): number {
  if (!/^\d+$/.test(raw)) throw new HttpError(400, 'id must be a number');
  const id = Number(raw);
  if (!Number.isSafeInteger(id) || id < 1) throw new HttpError(400, 'id must be a positive number');
  return id;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be a string`);
  return value;
}

function listParamsFromQuery(query: Record<string, unknown>): ListParams {
  const kind = optionalString(query.kind, 'kind');
  if (kind !== undefined && kind !== '' && !isKind(kind)) {
    throw new HttpError(400, `kind must be one of: task, tutorial, command, sop, workflow, meeting`);
  }
  const tag = optionalString(query.tag, 'tag');
  const q = optionalString(query.q, 'q');
  const pinnedRaw = query.pinned;
  const pinned =
    pinnedRaw === '1' || pinnedRaw === 'true' || pinnedRaw === true
      ? true
      : pinnedRaw === undefined || pinnedRaw === '' || pinnedRaw === '0' || pinnedRaw === 'false'
        ? false
        : (() => {
            throw new HttpError(400, 'pinned must be 1 or 0');
          })();

  const limit = numberParam(query.limit, 'limit');
  const offset = numberParam(query.offset, 'offset');

  return {
    ...(kind ? { kind } : {}),
    ...(tag ? { tag } : {}),
    ...(q ? { q } : {}),
    pinned,
    ...(limit !== undefined ? { limit } : {}),
    ...(offset !== undefined ? { offset } : {}),
  };
}

function numberParam(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const text = String(value);
  if (!/^-?\d+$/.test(text)) throw new HttpError(400, `${field} must be an integer`);
  return Number(text);
}

function entryPayload(body: unknown, mode: 'create' | 'patch'): {
  kind?: string;
  title?: string;
  body?: string;
  tags?: string | string[];
  pinned?: boolean;
} {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new HttpError(400, 'body must be a JSON object');
  }
  const input = body as Record<string, unknown>;
  const out: { kind?: string; title?: string; body?: string; tags?: string | string[]; pinned?: boolean } = {};

  if (input.kind !== undefined) {
    if (!isKind(input.kind)) {
      throw new HttpError(400, 'kind must be one of: task, tutorial, command, sop, workflow, meeting');
    }
    out.kind = input.kind;
  } else if (mode === 'create') {
    throw new HttpError(400, 'kind is required');
  }

  if (input.title !== undefined) {
    if (typeof input.title !== 'string' || input.title.trim() === '') {
      throw new HttpError(400, 'title must be a non-empty string');
    }
    out.title = input.title.trim();
  } else if (mode === 'create') {
    throw new HttpError(400, 'title is required');
  }

  const bodyText = optionalString(input.body, 'body');
  if (bodyText !== undefined) out.body = bodyText;

  if (input.tags !== undefined) {
    if (typeof input.tags === 'string') {
      out.tags = input.tags;
    } else if (Array.isArray(input.tags) && input.tags.every((tag) => typeof tag === 'string')) {
      out.tags = input.tags as string[];
    } else {
      throw new HttpError(400, 'tags must be a string or an array of strings');
    }
  }

  if (input.pinned !== undefined) {
    if (typeof input.pinned !== 'boolean') throw new HttpError(400, 'pinned must be a boolean');
    out.pinned = input.pinned;
  }

  return out;
}

export interface BuildOptions {
  db?: Db;
  dbPath?: string;
  logger?: boolean;
}

export function buildServer(options: BuildOptions = {}): FastifyInstance {
  const db = options.db ?? initDb(options.dbPath ?? resolveDbPath());
  const app = Fastify({ logger: options.logger ?? false });

  // public/ is wiwi's; the app must boot before it exists.
  fs.mkdirSync(publicDir, { recursive: true });
  app.register(fastifyStatic, { root: publicDir, prefix: '/', decorateReply: true });

  // One place where /admin and the writing API can be closed later. Off today.
  registerAdminGuard(app);

  // ---------- HTML ----------

  app.get('/', async (request, reply) => {
    const params = listParamsFromQuery(request.query as Record<string, unknown>);
    const entries = listEntries(db, params);
    return reply
      .type('text/html; charset=utf-8')
      .send(
        renderList({
          entries,
          kind: params.kind,
          tag: params.tag,
          q: params.q,
          pinned: params.pinned,
        }),
      );
  });

  app.get('/entry/:id', async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const id = parseId(rawId);
    const entry = getEntry(db, id);
    if (!entry) throw new HttpError(404, `entry ${id} not found`);
    return reply.type('text/html; charset=utf-8').send(renderEntry(entry));
  });

  app.get('/tags', async (_request, reply) => {
    return reply.type('text/html; charset=utf-8').send(renderTags(listTags(db)));
  });

  app.get('/admin', async (_request, reply) => {
    const indexFile = path.join(publicDir, 'admin', 'index.html');
    if (fs.existsSync(indexFile)) {
      return reply.type('text/html; charset=utf-8').send(fs.readFileSync(indexFile, 'utf8'));
    }
    return reply.type('text/html; charset=utf-8').send(renderAdminPlaceholder());
  });

  // ---------- health ----------

  const health = async (_request: FastifyRequest, reply: FastifyReply) =>
    reply.type('application/json; charset=utf-8').send({ status: 'ok' });

  app.get('/health', health);
  app.get('/api/health', health);

  // ---------- JSON API ----------

  app.get('/api/entries', async (request) => {
    const params = listParamsFromQuery(request.query as Record<string, unknown>);
    // rank is an ordering device, not part of the entry the dashboard edits
    const entries = listEntries(db, params).map(({ rank: _rank, ...entry }) => entry);
    return { entries };
  });

  app.get('/api/entries/:id', async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = parseId(rawId);
    const entry = getEntry(db, id);
    if (!entry) throw new HttpError(404, `entry ${id} not found`);
    return entry;
  });

  app.post('/api/entries', async (request, reply) => {
    const payload = entryPayload(request.body, 'create');
    const entry = createEntry(db, {
      kind: payload.kind as Entry['kind'],
      title: payload.title as string,
      body: payload.body,
      tags: payload.tags,
      pinned: payload.pinned,
    });
    return reply.code(201).send(entry);
  });

  app.patch('/api/entries/:id', async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = parseId(rawId);
    const payload = entryPayload(request.body, 'patch');
    const entry = updateEntry(db, id, {
      kind: payload.kind as Entry['kind'] | undefined,
      title: payload.title,
      body: payload.body,
      tags: payload.tags,
      pinned: payload.pinned,
    });
    if (!entry) throw new HttpError(404, `entry ${id} not found`);
    return entry;
  });

  app.delete('/api/entries/:id', async (request, reply) => {
    const { id: rawId } = request.params as { id: string };
    const id = parseId(rawId);
    if (!deleteEntry(db, id)) throw new HttpError(404, `entry ${id} not found`);
    return reply.code(204).send();
  });

  app.post('/api/entries/:id/pin', async (request) => {
    const { id: rawId } = request.params as { id: string };
    const id = parseId(rawId);
    const entry = togglePin(db, id);
    if (!entry) throw new HttpError(404, `entry ${id} not found`);
    return entry;
  });

  app.get('/api/tags', async () => ({ tags: listTags(db) }));

  // ---------- errors ----------

  app.setNotFoundHandler((request, reply) => {
    if (wantsJson(request)) {
      return reply.code(404).type('application/json; charset=utf-8').send({
        error: 'not found',
        statusCode: 404,
      });
    }
    return reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(renderError(404, 'That page does not exist.'));
  });

  app.setErrorHandler((rawError: unknown, request, reply) => {
    const error = rawError as { message?: string; statusCode?: number };
    const status =
      error instanceof HttpError
        ? error.status
        : typeof (error as { statusCode?: number }).statusCode === 'number' &&
            (error as { statusCode: number }).statusCode < 500
          ? (error as { statusCode: number }).statusCode
          : 500;

    const message =
      status === 500
        ? 'Something went wrong on the server.'
        : rawError instanceof HttpError
          ? rawError.message
          : error.message || 'Bad request';

    // The log keeps the stack; the client never sees it.
    if (status >= 500) request.log.error(error);

    if (wantsJson(request)) {
      return reply
        .code(status)
        .type('application/json; charset=utf-8')
        .send({ error: message, statusCode: status });
    }
    return reply.code(status).type('text/html; charset=utf-8').send(renderError(status, message));
  });

  return app;
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const port = Number(process.env.PORT ?? 8000);
  const host = process.env.HOST ?? '0.0.0.0';
  const app = buildServer({ logger: true });
  app
    .listen({ port, host })
    .then(() => {
      app.log.info(`notulen listening on http://${host}:${port}`);
    })
    .catch((error: unknown) => {
      app.log.error(error);
      process.exit(1);
    });
}
