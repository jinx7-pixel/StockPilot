# Getting Started — StockPilot

Step-by-step local setup for StockPilot. See
[`architecture.md`](./architecture.md) for how the pieces fit together.

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | 24 recommended to match CI and Docker | `node -v` |
| npm | 10+ | `npm -v` |
| Git | any recent | `git --version` |
| Docker | any recent, for local PostgreSQL | `docker --version` |

Docker is needed only for the local database. If you already run PostgreSQL 18
locally, point `PG*` in `backend/.env` at it and skip the compose step.

## 1. Install dependencies

```bash
git clone <your-repo-url> stockpilot
cd stockpilot

npm ci --prefix frontend
npm ci --prefix backend
```

Frontend and backend have separate dependency trees on purpose.

## 2. Start the database

```bash
docker compose up -d db
docker compose ps        # expect STATUS "healthy"
```

This starts PostgreSQL 18 with the local database `stockpilot`, owner role
`stockpilot`, and password `stockpilot_local_dev`. The named volume
`stockpilot_pgdata` holds the database across container restarts.

```bash
docker compose logs -f db   # follow startup logs
docker compose down         # stop
docker compose down -v      # stop and delete all local data
```

> **Not using Docker?** A native PostgreSQL 18 works identically. Create the role
> and database yourself, then point the `PG*` variables in `backend/.env` at it.

## 3. Configure environment

Both apps read configuration from the environment; the committed
`.env.example` files are the contract.

```bash
# backend
cp backend/.env.example backend/.env

# frontend (Vite reads .env.local)
cp frontend/.env.example frontend/.env.local
```

For the default local Docker database, set `PGPASSWORD=stockpilot_local_dev`
in `backend/.env`. Keep real credentials in your ignored environment files.

## 4. Apply database migrations

```bash
cd backend
npm run migration:status
npm run migration:up
```

```
[migrate] target : postgresql://stockpilot@localhost:5432/stockpilot
[migrate] schema : public
[migrate] dir    : C:\StockPilot\database\migrations
[migrate] up 1791027517242_shared-database-helpers.ts
[migrate] done — 1 migration(s) applied.
```

This applies the migrations for workspace accounts, inventory, sales, purchasing,
and action history, and records each one in `pgmigrations`.

Full workflow, naming rules and rollback: [`database/README.md`](../database/README.md).

## 5. Run the backend

### Provision the runtime role

For a fresh Docker database, connect as the schema owner from the repository root
after applying the migrations. For a native database, use the same SQL in its
`psql` session.

```bash
docker compose exec db psql -U stockpilot -d stockpilot
```

```sql
CREATE ROLE stockpilot_app LOGIN;
\password stockpilot_app
GRANT CONNECT ON DATABASE stockpilot TO stockpilot_app;
GRANT USAGE ON SCHEMA public TO stockpilot_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  businesses, users, auth_sessions, auth_email_tokens, auth_attempts,
  categories, products, inventory_movements, sales, sale_items, suppliers,
  purchase_orders, purchase_order_items, actions TO stockpilot_app;
```

If the role already exists, run the grants only. Use your actual database,
schema, and runtime role names if they differ from the defaults. Create
`backend/.env.runtime` with the password you set in `psql`.

```bash
# backend/.env.runtime — local only, gitignored. Shape, not a real credential:
PGUSER=stockpilot_app
PGPASSWORD=...        # from your out-of-repo credential file; never commit
PGDATABASE=stockpilot
```

Configure `APP_PUBLIC_URL` and the SMTP settings from `backend/.env.example` in
`backend/.env.runtime` for account email. Set `MFA_ENCRYPTION_KEY` to enable
authenticator setup. The dashboard preview uses sample data and runs with the
frontend alone.

`.env.runtime` is intentionally **required**: if it is missing, Node refuses to
start rather than quietly falling back to the owner account.

```bash
cd backend
npm run dev:local     # development (no hot reload)
# or, against a production build:
npm run build
npm run start:local
```

`npm run dev` and `npm run start` are unchanged and still read `backend/.env`,
which keeps the **owner/admin** role for:

- migrations — `npm run migration:up`, `:down`, `:status`;
- the test suite — `npm test`, which also needs to create and truncate
  `stockpilot_test`.

Neither of them reads `.env.runtime` — the restricted role has no DDL rights and
cannot read the migration history, so they would fail if it did. Run them
exactly as documented above; only the API uses the runtime credentials.

For hot reload with the restricted role, export the two variables and then run
`npm run dev` as normal.

⚠️ **Shell variables win.** `--env-file` does not override a `PG*` variable that
is already exported in your shell. If the API is not using the restricted role,
check for stray `PG*` variables — check *whether they are set*, never print
their values.

**Never commit or share `.env.runtime`.** It is ignored by Git and holds a live
credential.

Expected output:

```
[stockpilot-api] listening on http://0.0.0.0:4000 (env: development)
[stockpilot-api] health check: http://localhost:4000/api/health
```

Verify:

```bash
curl http://localhost:4000/api/health
```

```json
{ "status": "ok", "service": "stockpilot-api" }
```

## 6. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173>. The StockPilot foundation page loads. The dev
server proxies `/api/*` to the backend, so
<http://localhost:5173/api/health> also returns the health JSON — a
one-command end-to-end check that both halves are wired together.

## 7. Quality checks

Run from each package directory.

```bash
# backend
cd backend
npm run typecheck   # tsc --noEmit, strict — covers the app AND migrations
npm run lint        # ESLint 10 — covers the app AND migrations
npm run build       # emit dist/

# frontend
cd frontend
npm run typecheck   # tsc -b, app + tooling configs
npm run lint        # ESLint 10 + typescript-eslint + react-hooks
npm run build       # type-check then vite build -> dist/
npm run preview     # serve the production build locally
```

## Useful commands

| Purpose | Command |
| --- | --- |
| Backend dev with auto-reload | `cd backend && npm run dev` |
| Backend production run | `cd backend && npm run build && npm start` |
| Frontend dev with HMR | `cd frontend && npm run dev` |
| Frontend production preview | `cd frontend && npm run build && npm run preview` |
| Create a migration | `cd backend && npm run migration:create -- <slug>` |
| Apply migrations | `cd backend && npm run migration:up` |
| Roll back the latest migration | `cd backend && npm run migration:down` |
| Check migration state | `cd backend && npm run migration:status` |
| Graceful API shutdown | `Ctrl+C` (SIGINT) — drains requests, closes the pool |

## Troubleshooting

**`EADDRINUSE: address already in use :::4000`**
Another process owns port 4000. Either stop it, or set `PORT` in
`backend/.env` (and match `VITE_API_PROXY_TARGET` in
`frontend/.env.local`).

**`Missing required environment variable: …`**
`config/env.ts` validates at startup on purpose. Copy the missing variable from
`backend/.env.example` into `backend/.env` rather than hard-coding a fallback in
source.

**`ECONNREFUSED` from the frontend**
The backend is not running, or the proxy target is wrong. Confirm
`http://localhost:4000/api/health` directly, then check
`VITE_API_PROXY_TARGET`.

**CORS errors**
`CORS_ORIGINS` in `backend/.env` must list the exact browser origin, e.g.
`http://localhost:5173` (scheme + host + port, no trailing slash). Note that with
the dev proxy in place, requests are same-origin and CORS is bypassed entirely.

**Database refuses connections**
`docker compose ps` should show `healthy`. If the container is restarting, run
`docker compose logs db`. Remember to delete the volume
(`docker compose down -v`) if you changed `POSTGRES_USER` or
`POSTGRES_PASSWORD` — the credentials live in the volume, not the compose file.
