# StockPilot — Backend

Node.js 22+ · Express 5 · TypeScript 5.9 (strict, ESM).

This package is at the **foundation stage**: the API serves a health endpoint and
is wired for PostgreSQL connectivity. No business features yet.

## Setup

```bash
cp .env.example .env   # local-only, git-ignored
npm install
npm run dev            # http://localhost:4000
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | `tsx watch` — dev server with auto-reload |
| `npm run typecheck` | Type-check the app **and** the migrations |
| `npm run lint` | Lint the app **and** the migrations |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled server |
| `npm run migration:create -- <slug>` | Create a timestamped migration |
| `npm run migration:up` | Apply all pending migrations |
| `npm run migration:down` | Roll back the latest migration |
| `npm run migration:redo` | Roll back and re-apply the latest |
| `npm run migration:status` | Show applied vs pending migrations |

## API

| Method | Path | Response |
| --- | --- | --- |
| `GET` | `/api/health` | `{"status":"ok","service":"stockpilot-api"}` |
| `GET` | `/` | Service metadata pointer |
| `*` | *(unmatched)* | JSON `404` |

`/api/health` never touches the database, so a database outage cannot make the
HTTP process appear dead.

## Structure

```
src/
├── server.ts           # Process lifecycle, listen, graceful shutdown
├── app.ts              # Express app factory (separated for testability)
├── config/
│   ├── env.ts          # Validated env access
│   └── index.ts
├── db/
│   ├── config.ts       # Shared connection config (pool + migrations)
│   ├── pool.ts         # pg pool, query(), withTransaction(), checkConnection()
│   ├── migrate.ts      # Migration CLI (tooling only, not shipped)
│   └── index.ts
├── middlewares/
│   ├── errorHandler.ts
│   └── notFoundHandler.ts
└── routes/
    ├── index.ts        # apiRouter — mount new modules here
    └── health.routes.ts
```

### Layering

`routes → services → repositories → db`, dependencies pointing inward only.
Today only `routes`, `middlewares`, `db` and `config` exist; `services/` and
`repositories/` are the seam where business logic and SQL will go.

### Environment access

`src/config/env.ts` is the **only** module permitted to read `process.env`. It
validates once at import time and exports a typed, immutable `env` object, so a
missing variable fails fast at startup with a clear message instead of surfacing
as `undefined` inside a request.

## Database

`db/config.ts` turns environment variables into a `pg` config object. It is the
single source of connection settings, used by both the application pool
(`db/pool.ts`) and the migration runner (`db/migrate.ts`) — so a migration can
never be pointed at a different database than the API.

Schema changes are applied **only** through versioned migrations in
`database/migrations/`, managed with `node-pg-migrate`. No application code
creates or alters tables. See [`../database/README.md`](../database/README.md).

All SQL goes through parameterised `query(sql, values)`. Never interpolate input
into a query string.

The pool is created lazily, survives idle-client errors without crashing, and is
drained on `SIGTERM`/`SIGINT` (10s force-exit timeout).

`db/migrate.ts` is tooling only: it is excluded from the production build and is
never imported by the running API.

## Configuration

See `.env.example` for the full contract. Highlights:

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `HOST` / `PORT` | `0.0.0.0` / `4000` | Listen address |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated origin allow-list |
| `LOG_LEVEL` | `debug` | `debug` \| `info` \| `warn` \| `error` \| `silent` |
| `DATABASE_URL` | *(unset)* | Full connection string; takes precedence |
| `PGHOST` … `PGSSLMODE` | local defaults | Discrete libpq-style variables |
| `PGPOOL_MAX` | `10` | Pool size |
| `PGCONNECT_TIMEOUT_MS` | `5000` | Connection timeout |
| `PGSCHEMA` | `public` | Schema migrations run against |
| `PGMIGRATIONS_TABLE` | `pgmigrations` | Migration tracking table |
| `MIGRATIONS_DIR` | `../database/migrations` | Migration directory |

`JWT_SECRET` and `OPENAI_API_KEY` are reserved for later milestones and are
intentionally blank.

---

See the [root README](../README.md), [`docs/architecture.md`](../docs/architecture.md)
and [`docs/getting-started.md`](../docs/getting-started.md).
