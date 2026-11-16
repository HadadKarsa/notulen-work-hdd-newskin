import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

/**
 * One place where the admin surface can be closed.
 *
 * The owner chose to run /admin without a login for now. That choice must not
 * spread across the routing: every admin path and every API path except health
 * passes through this hook, so a later password mode is one edit here and no
 * edit anywhere else.
 *
 * Modes, from the ADMIN_LOCK env var:
 *   off      (default) the hook lets everything through
 *   password the hook refuses everything until password mode is implemented
 *
 * Failing closed on an unrecognised or unimplemented mode is deliberate. A
 * typo in ADMIN_LOCK must not silently reopen the notebook.
 */

export type LockMode = 'off' | 'password';

const OPEN_PATHS = new Set(['/health', '/api/health']);

export function readLockMode(env: NodeJS.ProcessEnv = process.env): LockMode {
  const raw = (env.ADMIN_LOCK ?? 'off').trim().toLowerCase();
  if (raw === '' || raw === 'off' || raw === 'false' || raw === '0') return 'off';
  return 'password';
}

/**
 * True for a path the lock covers: /admin and its assets, and the whole JSON
 * API except its health check. Public reading pages (/, /entry/:id, /tags) are
 * never covered, so a locked notebook still reads like a document.
 */
export function isGuardedPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  if (OPEN_PATHS.has(path)) return false;
  if (path === '/admin' || path.startsWith('/admin/')) return true;
  if (path === '/api' || path.startsWith('/api/')) return true;
  return false;
}

export function registerAdminGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!isGuardedPath(request.url)) return;
    const mode = readLockMode();
    if (mode === 'off') return;

    // mode === 'password' and no verifier exists yet: refuse, do not fall open.
    request.log.warn('ADMIN_LOCK is set but password mode is not implemented');
    return reply
      .code(503)
      .type('text/html; charset=utf-8')
      .send(
        '<!doctype html><html lang="id"><head><meta charset="utf-8"><title>Dasbor terkunci</title></head>' +
          '<body><h1>Dasbor terkunci</h1><p>ADMIN_LOCK aktif tetapi mode password belum ada di build ini. ' +
          'Setel ADMIN_LOCK=off atau pasang mode password.</p></body></html>',
      );
  });
}
