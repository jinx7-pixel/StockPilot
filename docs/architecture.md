# Architecture — StockPilot

Foundation-stage architecture. This describes what is true **today**, plus the
boundaries that keep the codebase scalable as business modules arrive.

## Repository shape

A lightweight monorepo: two independently installable, independently runnable
applications plus shared documentation, sharing a single root `.gitignore` and
Git history.

```
StockPilot/
├── frontend/     React + TypeScript + Vite + Tailwind CSS   (port 5173)
├── backend/      Node.js + Express + TypeScript             (port 4000)
├── database/     schema migrations + data documentation
├── docs/         architecture, guides, future ADRs
├── .github/workflows/   CI (ci.yml); deployment workflows not yet added
└── docker-compose.yml   local PostgreSQL 18 only
```
Frontend and backend communicate over **REST** (`/api/*`). There is no shared
runtime package yet — the only things genuinely shared are the API contract and
the root tooling conventions, so a premature `packages/shared` monorepo layer
was deliberately avoided.

## Backend layering

Dependencies point **inward only**: `routes → services → repositories → db`.
A layer may import from layers below it, never from layers above it.

```mermaid
graph TD
    A[server.ts<br/>process lifecycle] --> B[app.ts<br/>express wiring]
    B --> C[middlewares/]
    B --> D[routes/index.ts<br/>/api/*]
    D --> E[health.routes.ts]
    D -. future .-> F[products / inventory /<br/>suppliers / sales routers]
    F -.-> G[services/  business logic]
    G -.-> H[repositories/  SQL]
    H --> I[db/pool.ts]
    I --> J[(PostgreSQL 18)]
    B --> K[config/env.ts]
```

| Layer | Responsibility | Never does |
| --- | --- | --- |
| `server.ts` | process lifecycle, listen, graceful shutdown, signal handling | handle requests |
| `app.ts` | middleware order, mounting routers | business logic |
| `config/env.ts` | read + validate process env once, at import time | read `process.env` elsewhere |
| `routes/` | HTTP shape only: parse, delegate, respond | SQL, business rules |
| `middlewares/` | cross-cutting concerns (404, errors, logging) | route-specific logic |
| `services/` *(planned)* | business rules and orchestration | touch `req`/`res` |
| `repositories/` *(planned)* | all SQL and row mapping | business rules |
| `db/pool.ts` | connection lifecycle, parameterised queries | schema creation |

**`config/env.ts` is the only module allowed to read `process.env`.** Everything
else imports the validated `env` object, so a missing variable fails once, at
startup, with a clear message — instead of surfacing as `undefined` deep inside a
request.

### Current API surface

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/health` | `{"status":"ok","service":"stockpilot-api"}` |

`/api/health` is intentionally dependency-free — it does not query PostgreSQL, so
a database outage can never make the HTTP process look dead.

## Database

The backend holds a single lazily-created `pg` connection pool per process
(`db/pool.ts`). It is opened on first use, reports idle-client errors without
crashing, supports `withTransaction`, and is drained on `SIGTERM`/`SIGINT`.

Connection settings are defined exactly once, in `db/config.ts`
(`buildClientConfig()`), which reads the validated `env` object. Both the
application pool and the migration runner build their clients from that one
function, so a migration can never be pointed at a different database than the
API — a bug that is otherwise very hard to diagnose.

**No tables are created by application code.** The schema is applied exclusively
through versioned migrations committed under `database/migrations/` and run with
`node-pg-migrate` via `db/migrate.ts`. Migrations run inside a single
transaction, under a PostgreSQL advisory lock, with out-of-order detection
enabled. See [`database/README.md`](../database/README.md).

`db/migrate.ts` is tooling: excluded from the production build, never imported by
the API.

## Frontend

- **Vite 8** dev server / bundler, **React 19**, **TypeScript 6** (strict).
- **Tailwind CSS 4** via the `@tailwindcss/vite` plugin — no PostCSS config
  file, no separate `tailwind.config.js`; theme tokens are declared with
  `@theme` in `src/index.css`.
- **Strict type-check** in `tsconfig.app.json` plus a separate
  `tsconfig.node.json` for build tooling; `tsc -b` type-checks both.
- **ESLint 10** flat config with `typescript-eslint`, `react-hooks` and
  `react-refresh`.

### Talking to the API

`vite.config.ts` proxies `/api` → `http://localhost:4000` in dev. The frontend
therefore calls **relative** `/api/...` paths: no hard-coded backend host, and
CORS never enters the picture locally. `VITE_API_BASE_URL` exists in
`.env.example` for the case where a separate API origin is genuinely needed.

## Security posture

- **No secrets in source control.** `.gitignore` blocks `.env`, `.env.*` and
  common key/cert extensions; `.env.example` files are the committed contract
  and contain placeholders only.
- **Nothing typed as `VITE_*` is secret** — those values are inlined into the
  public browser bundle.
- **Parameterised SQL only**; `query()` takes a values array, never string
  interpolation.
- `app.disable('x-powered-by')`; CORS is an explicit origin allow-list from
  `CORS_ORIGINS`, not `*`.
- Error responses never leak stack traces in production; details go to the
  server log only.

## Scaling path (not built yet)

Each of these is a deliberate seam, not existing code:

- **Modules** → new `routes/x.routes.ts` + `services/` + `repositories/`, mounted
  in `routes/index.ts`. No changes to `app.ts`.
- **Migrations** → `npm run migration:create -- <slug>`, then `migration:up`. No
  application change required.
- **Auth** → a middleware plus `env` additions; routes opt in individually.
- **Docker** → `docker-compose.yml` already isolates the `db` service, so
  frontend/backend services can be added beside it.
- **CI** → `ci.yml` already runs `lint`, `typecheck` and `build` for the app and
  the migrations on every push and pull request, with no database and no
  secrets. Adding a module means adding a new script only if the existing gates
  do not cover it.
- **CD / deploy** → not implemented. `migration:up` is deliberately absent from
  CI; it belongs in a deploy step, and it is safe to run repeatedly: it applies
  only pending migrations and serialises concurrent runs with an advisory lock.
