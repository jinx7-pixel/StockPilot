# Migrations — StockPilot

Versioned, append-only schema migrations for the StockPilot PostgreSQL database.
Managed with [`node-pg-migrate`](https://node-pg-migrate.vercel.app/).

- **Runner:** `node-pg-migrate` (dev dependency, `backend/`)
- **Command wrapper:** `backend/src/db/migrate.ts`
- **Applied to:** the same env-configured database the API uses
- **Tracking table:** `pgmigrations` (in the `public` schema by default)

## Rules

1. **Append-only.** Never edit or delete a migration that has been applied
   anywhere. Ship a corrective migration instead.
2. **One logical change per file.**
3. **Reversible where practical.** Every migration should have a working `down`.
   Use `IF EXISTS` / `IF NOT EXISTS` so a partially-applied state can still be
   unwound.
4. **Idempotent and safe to re-run.** `npm run migration:up` applies only
   pending migrations; running it twice is a no-op.
5. **Migrations are source code** — committed, reviewed, and covered by the same
   quality gates as the API. Tooling configs live one level up in `database/`
   (this directory holds migration files only) and are driven by
   `npm run typecheck` / `npm run lint` from `backend/`.
6. **No business data.** Seed/demo data belongs in `database/seeds/`, never in a
   migration, and never in production.
7. **No secrets.** Connection details come from environment variables only.
8. **No application imports.** A migration must be replayable against any database
   at any past point in time, so it may only depend on `node-pg-migrate` and
   plain SQL.

## Commands

Run from the `backend/` directory.

```bash
npm run migration:create -- add-widget-tables   # create a new migration file
npm run migration:status                        # show applied vs pending
npm run migration:up                            # apply all pending migrations
npm run migration:down                          # roll back the latest migration
npm run migration:down -- 3                     # roll back the latest three
npm run migration:redo                          # roll back and re-apply the latest
```

See [`README.md`](../README.md) in this directory for the full workflow,
required environment variables, and troubleshooting.
