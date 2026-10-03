# Database — StockPilot

This directory owns the **PostgreSQL schema lifecycle** for StockPilot.

## Current status: no tables yet

The project is at the **foundation stage**. The database server, credentials and
connection pool are configured, but **no application tables, indexes, views or
triggers have been created**. That is deliberate — schema design happens with the
business modules, not before them.

What exists today:

| Path | Purpose | Status |
| --- | --- | --- |
| `backend/src/db/pool.ts` | `pg` connection pool + query helpers, built from env vars | ✅ present |
| `backend/.env.example` | `PG*` / `DATABASE_URL` variable template | ✅ present |
| `docker-compose.yml` (root) | local PostgreSQL 18 service | ✅ present |
| `migrations/` | versioned schema migrations | ⏳ reserved, not created yet |

## Schema will be managed through migrations

All schema changes will be applied through **versioned, forward-only migrations**
— never by hand-editing a live database, and never by code that runs
`CREATE TABLE` on application startup.

Planned layout:

```
database/
├── migrations/            # numbered, append-only SQL migrations (committed)
│   ├── 0001_init.sql
│   └── ...
├── seeds/                 # optional local-only development data (not yet created)
└── README.md              # this file
```

Rules we will follow:

1. **Append-only.** Never edit or delete a migration that has been merged.
   Corrections ship as a new migration.
2. **One logical change per file**, named `<timestamp>_<slug>.sql` so ordering is
   unambiguous in both Git and the filesystem.
3. **Reversible.** Every migration gets a paired `down` section (or an explicit
   `DROP` path) so a bad release can be rolled back.
4. **Committed to Git.** Migrations are source code and are reviewed like code.
5. **No business data in migrations.** Seed/demo data lives in `seeds/` and is
   never applied in production.
6. **No secrets.** Credentials come from environment variables only.

## Local setup (foundation stage)

```bash
# from the repository root
docker compose up -d db      # start PostgreSQL 18
docker compose ps            # confirm it reports healthy

cd backend
cp .env.example .env         # local credentials only, never committed
npm run dev
```

Verify connectivity with any client, e.g.:

```bash
docker compose exec db psql -U stockpilot -d stockpilot -c "\conninfo"
```

An empty schema is expected and correct at this stage.

## Migrations tool

The migration runner (e.g. `node-pg-migrate`) has **not been selected or
installed yet** — that decision is part of the database milestone. When it is,
it will be pinned in `backend/package.json` and documented here, and this
README will be updated with the exact up/down commands.
