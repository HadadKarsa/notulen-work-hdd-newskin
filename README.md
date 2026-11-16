# notulen new-skin

A personal notebook for tasks, tutorials, commands, SOPs, workflows and meeting notes.
One Node process serves server-rendered public pages and a React dashboard at `/admin`,
and keeps everything in one SQLite file.

This is the rewrite of notulen-work-hdd on Node 22, TypeScript, Fastify 5 and
better-sqlite3. It reads the same `entry` table, so an existing v2 database opens as-is.

## Stack

- Node 22, TypeScript, ESM
- Fastify 5
- better-sqlite3 (native module, so a build needs python3, make and g++)
- React 18 dashboard built by Vite into `public/admin`
- markdown-it with `html: false`

## Run locally

```sh
npm ci
npm run build     # tsc for the server, then vite for the dashboard
npm start         # node dist/server.js
```

Open http://localhost:8000 for the public pages and http://localhost:8000/admin for the dashboard.

`npm run build` is required before `npm start`: `dist/` and `public/admin/` are build output
and both are gitignored. Without it, `/admin` serves a placeholder instead of the dashboard.

The database path defaults to `/data/notulen.db` when `/data` is writable, otherwise to
`./notulen.db` in the current directory. Set it explicitly to be sure:

```sh
DB_PATH=./notulen.db npm start
```

Tests and typecheck:

```sh
npm test
npm run typecheck
```

## Run with docker

```sh
docker build -t notulen-newskin .
docker run -d --name notulen-newskin \
  -p 8000:8000 \
  -v newskin_app_data:/data \
  -e ADMIN_LOCK=off \
  notulen-newskin
```

Or with the reference compose file:

```sh
docker compose up -d
```

The compose file publishes no ports on purpose. In prod, Caddy proxies to the container on
the shared Docker network, so the app and its dashboard are never reachable without TLS.

## Persistence

The app writes one file: `/data/notulen.db`. That path is a declared `VOLUME` in the
Dockerfile and a named volume `newskin_app_data` in the compose file.

Without the volume mounted, the database lives inside the container's writable layer and
every note is lost the next time the container is recreated, for example on an image
update or a `docker compose down`. The volume name is deliberately not `stack_app_data`,
which holds the retired v2 data; do not point this container at it.

Back up the volume by copying the file out, not by copying the directory while the app is
running without care:

```sh
docker run --rm -v newskin_app_data:/data -v "$PWD:/backup" alpine \
  cp /data/notulen.db /backup/notulen-$(date +%F).db
```

## Environment

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8000` | HTTP port the server listens on |
| `HOST` | `0.0.0.0` | Interface the server binds |
| `DB_PATH` | `/data/notulen.db` | SQLite file path; falls back to `./notulen.db` if `/data` is not writable |
| `ADMIN_LOCK` | `off` | `off` leaves `/admin` and the write API open. Any other value fails closed with 503 until password mode exists |

## Access and auth

`/admin` has no login by design for now. It is a personal tool and the owner decides where
it is reachable. Every `/admin` path and every `/api` path except the health checks passes
through one preHandler hook gated by `ADMIN_LOCK`, so a password mode is one edit in
`src/guard.ts` and nothing else.

`ADMIN_LOCK` currently understands `off` only. Setting it to anything else makes the guarded
routes answer 503 rather than fall open, which is deliberate: a typo must not silently
unlock the notebook. The public reading pages and `/health` are never locked.

## Routes

Public HTML: `/`, `/entry/:id`, `/tags`, `/health`.

JSON API: `/api/entries`, `/api/entries/:id`, `/api/entries/:id/pin`, `/api/tags`,
`/api/health`.

## Image and CI

`.github/workflows/deploy.yml` runs on push to `main` and on pull requests to `main`: install,
typecheck, test, build, then build the image and push it to
`ghcr.io/hadadkarsa/notulen-work-hdd-newskin` tagged with the commit SHA and `latest`.
It deploys nothing. Prod pulls the image and runs the compose file.

The Dockerfile is multi-stage. The build stage installs python3, make and g++ for
better-sqlite3 and builds both the server and the dashboard. The runtime stage has no build
tools, runs as uid 10001, declares `/data` as a volume and healthchecks `/health`.
