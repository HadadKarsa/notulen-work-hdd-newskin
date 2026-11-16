# SPEC.md: notulen new-skin

Owner decisions (2026-11-16): repo `HadadKarsa/notulen-work-hdd-newskin`, branch `dev`.
Design: mature modern dashboard, warm palette with a dark switch, several typefaces, antislop DURING.
No login for now: it is a personal tool. Read DESIGN.md before writing any UI.

## Stack

- Node 22 LTS, TypeScript, ESM.
- Fastify 5 for HTTP.
- `better-sqlite3` for storage. Not `node:sqlite`: it still prints ExperimentalWarning on Node 22,
  and this runs in production for one person who will not read warnings.
- Public pages server-rendered HTML, no client framework, no hydration.
- Dashboard at `/admin`: React 18 + Vite, built to `public/admin`, served as static files by the
  same Fastify instance. One process, one port, one container.
- Markdown: `markdown-it` with `html: false` (raw HTML in a note must never become markup).
- No ORM. Hand-written SQL in one module.

## Data

Table `entry`, unchanged from v2 so an existing `/data/notulen.db` opens as-is:

    id          INTEGER PRIMARY KEY AUTOINCREMENT
    kind        TEXT NOT NULL            -- task|tutorial|command|sop|workflow|meeting
    title       TEXT NOT NULL
    body        TEXT NOT NULL DEFAULT ''
    tags        TEXT NOT NULL DEFAULT '' -- comma separated, normalised
    pinned      INTEGER NOT NULL DEFAULT 0
    created_at  TEXT NOT NULL
    updated_at  TEXT NOT NULL

Migration: read `PRAGMA table_info(entry)`, add `pinned` only when absent. Idempotent. A v1 or v2
database must open with every row intact. Indexes: `created_at`, `pinned`, `kind`.

## HTTP

Public, HTML:

    GET  /                    list; ?kind= ?tag= ?q= ?pinned=1
    GET  /entry/:id           one entry
    GET  /tags                all tags with counts
    GET  /health              200 {"status":"ok"}, no auth, no dependency on the database being warm

JSON API for the dashboard, under `/api`:

    GET    /api/entries       ?kind= ?tag= ?q= ?pinned=1&limit=50&offset=0
    GET    /api/entries/:id
    POST   /api/entries
    PATCH  /api/entries/:id
    DELETE /api/entries/:id
    POST   /api/entries/:id/pin      toggles, returns the new state
    GET    /api/tags
    GET    /api/health

Search ranking, one statement, deterministic:
`CASE WHEN title LIKE ? THEN 0 WHEN tags LIKE ? THEN 1 WHEN body LIKE ? THEN 2 ELSE 3 END AS rank`,
ordered `pinned DESC, rank, created_at DESC, id DESC`.

Tag filter exact, never substring: `instr(',' || tags || ',', ',tag,') > 0`.
Tags normalised on write: trim, lowercase, drop empties and duplicates, join with `,`.

## Errors

Every error is HTML on the public routes and JSON on `/api`, never a stack trace and never
Fastify's default JSON on a page. 404 for a missing entry or unknown path, 400 for a non-numeric
id or an invalid kind, 500 for the unexpected. The dashboard shows an error state with a retry.

## Dashboard (`/admin`)

Not a second app for its own sake: the same notebook with the pen in hand.

- Filter rail: kind, tag, search box, pinned toggle. The URL carries the state so a view can be
  bookmarked and reloaded (`/admin?tag=docker`).
- Working list: rows, dense, keyboard navigable. Enter opens, `e` edits, `/` focuses search,
  `p` pins, `Delete` asks before removing.
- Editor: title, kind, tags, body with a live preview toggle. Save with Ctrl/Cmd+Enter.
- Every list has empty, loading and error states. Empty says what to do next in one sentence.
- Optimistic pin and delete, rolled back with a message on failure.
- No login. It is reachable only where the owner puts it.

## Non-goals

No accounts, no sharing, no attachments, no audio, no notifications, no websockets, no separate
database container, no client-side router beyond the dashboard's own state.

## Acceptance criteria, each naming who checks it

| # | Criterion | Checked by |
|---|---|---|
| 1 | `npm run build` and `npm test` pass on the dev machine | dev |
| 2 | A v2 database opens with all rows and gains no duplicate column | dev |
| 3 | `GET /health` returns 200 JSON | dev, CI, prod |
| 4 | `/`, `/entry/:id`, `/tags`, `/admin` return 200 HTML | dev, prod |
| 5 | `/entry/abc` returns 400 HTML, `/entry/999` returns 404 HTML | dev |
| 6 | Dashboard: create, edit, pin, delete, search, filter all work, clicked through in a browser | dev |
| 7 | Both themes pass WCAG AA on every text pair | dev |
| 8 | No horizontal overflow at 390px; tap targets 44px | dev |
| 9 | No em dash in any UI copy | dev |
| 10 | `docker build` succeeds in CI, image pushed tagged with the commit SHA | CI |
| 11 | Container runs as non-root, `/data` is a declared volume, `/health` answers from the container | prod |

## Persistence

The app writes `/data/notulen.db`. `VOLUME ["/data"]` in the Dockerfile, a `## Persistence`
section in the README naming the path and the consequence of losing it, and `risk:` in the report
naming it. Without a mounted volume every note is lost on the next container recreate.
