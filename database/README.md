# Database — StockPilot

This directory owns the **PostgreSQL schema lifecycle** for StockPilot.

The schema is applied exclusively through **versioned, forward-only migrations**
run by [`node-pg-migrate`](https://node-pg-migrate.vercel.app/) — never by
hand-editing a live database, and never by application code that runs
`CREATE TABLE` at startup.

## Current status

**No business tables exist yet.** This milestone delivers the migration
*infrastructure* only. The following tables are explicitly **not** created:

`users` · `businesses` · `categories` · `products` · `suppliers` ·
`inventory_movements` · `sales` · `sale_items` · `purchase_orders` ·
`purchase_order_items` · `stock_adjustments` · `recommendations` · `audit_logs`

The single committed migration creates one generic helper function
(`set_updated_at()`) and no tables. It exists to establish the file format and to
prove the pipeline end to end.

| Path | Purpose | Status |
| --- | --- | --- |
| `migrations/` | Versioned migrations (committed) | ✅ 1 infrastructure migration |
| `tsconfig.json` | Type-checks `migrations/` | ✅ present |
| `eslint.config.js` | Lints `migrations/` | ✅ present |
| `package.json` | Marks this directory as an ESM package | ✅ present |
| `seeds/` | Local-only development data | ⏳ reserved, not created yet |
| `../backend/src/db/migrate.ts` | Typed CLI wrapper around node-pg-migrate | ✅ present |
| `../backend/src/db/config.ts` | Shared connection config (pool + migrations) | ✅ present |
| `../docker-compose.yml` | local PostgreSQL 18 service | ✅ present |

## Layout

```
database/
├── migrations/
│   └── 1791027517242_shared-database-helpers.ts   # <timestamp>_<slug>.ts
├── seeds/                  # ⏳ reserved — local dev data only, never in production
├── package.json            # marks this tree as an ESM package
├── tsconfig.json           # type-checks migrations/
├── eslint.config.js        # lints migrations/
└── README.md               # this file
```

> `migrations/` holds migration files **only**. Tooling configs live one level up
> in `database/`, because node-pg-migrate loads every non-ignored file in the
> migrations directory and would try to execute a stray `.js` config as a
> migration.

---

## Migration workflow

```
1. create   npm run migration:create -- <slug>     → new timestamped file
2. edit     write the up() and down() logic
3. review   npm run typecheck && npm run lint      (both cover this directory)
4. apply    npm run migration:up                   (local dev)
5. commit   the migration file alongside your code
```

The golden rule: **a schema change and the code that depends on it ship in the
same pull request.**

### Rules we follow

1. **Append-only.** Never edit or delete a migration that has been applied
   anywhere. Corrections ship as a new migration.
2. **One logical change per file**, named `<timestamp>_<slug>.ts`.
3. **Reversible where practical.** Every migration should have a working `down`
   that uses `IF EXISTS` / `IF NOT EXISTS`, so a partially-applied state can
   still be unwound.
4. **Safe to run repeatedly.** `migration:up` applies only pending migrations;
   running it twice is a no-op. All pending migrations commit in a single
   transaction — either all land, or none do.
5. **Order is enforced.** `checkOrder` is on, so adding a migration that sorts
   *before* already-applied ones fails loudly instead of corrupting history.
6. **Concurrent runners are serialised** with a PostgreSQL advisory lock
   (`advisoryLockMode: 'wait'`), so two deploys cannot migrate at once.
7. **Migrations are source code** — committed, reviewed, type-checked and linted.
8. **No business data.** Seed/demo data belongs in `seeds/` and is never applied
   in production.
9. **No secrets.** Connection details come from environment variables only.
10. **Migrations never import application code.** A migration must be replayable
    against any database at any past point in time, so it may only depend on
    `node-pg-migrate` and plain SQL.

---

## Required environment variables

All configuration is read from `backend/.env` by `src/config/env.ts`, which is the
only module permitted to touch `process.env`. Migrations and the application pool
share one connection config, so a migration can never be pointed at a different
database than the API.

Copy `backend/.env.example` → `backend/.env`. All values below have working local
defaults.

### Connection (shared with the API)

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | *(unset)* | Full connection string. Takes precedence when set. |
| `PGHOST` | `localhost` | Database host |
| `PGPORT` | `5432` | Database port |
| `PGDATABASE` | `stockpilot` | Database name |
| `PGUSER` | `stockpilot` | Database role |
| `PGPASSWORD` | *(unset)* | Database password — **never commit this** |
| `PGSSLMODE` | `disable` | `require` enables TLS for the connection |
| `PGCONNECT_TIMEOUT_MS` | `5000` | Connection timeout |

### Migration-specific (used only by `npm run migration:*`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PGSCHEMA` | `public` | Schema migrations run against |
| `PGMIGRATIONS_TABLE` | `pgmigrations` | Table recording applied migrations |
| `MIGRATIONS_DIR` | `../database/migrations` | Migration directory, relative to `backend/` |

> Changing `PGMIGRATIONS_TABLE` or `PGSCHEMA` after migrations have run orphans
> the existing history. Leave them alone unless you intend to re-baseline.

---

## Commands

All commands run from the `backend/` package.

| Command | What it does |
| --- | --- |
| `npm run migration:create -- <slug>` | Create a new timestamped `.ts` migration |
| `npm run migration:up` | Apply all pending migrations |
| `npm run migration:down` | Roll back the most recent migration |
| `npm run migration:down -- 3` | Roll back the most recent three |
| `npm run migration:redo` | Roll back and re-apply the most recent migration |
| `npm run migration:status` | List applied vs pending migrations |

### Create a migration

```bash
cd backend
npm run migration:create -- add-product-tables
# Created migration -- C:\StockPilot\database\migrations\1791027517242_add-product-tables.ts
```

This does **not** touch the database. The generated file looks like:

```ts
import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {}

export async function down(pgm: MigrationBuilder): Promise<void> {}
```

Names must be letters, digits, hyphens and underscores. Fill in `up`, then write
`down` before you commit.

### Run migrations

```bash
cd backend
npm run migration:status   # check what is pending
npm run migration:up
```

```
[migrate] target : postgresql://stockpilot@localhost:5432/stockpilot
[migrate] schema : public
[migrate] dir    : C:\StockPilot\database\migrations
[migrate] up 1791027517242_shared-database-helpers.ts
[migrate] done — 1 migration(s) applied.
```

### Roll back

```bash
npm run migration:down        # roll back the latest
npm run migration:down -- 3   # roll back the latest three
npm run migration:redo        # prove the latest migration is reversible
```

`redo` is the cheapest way to prove a `down` actually works — run it before
reviewing a migration.

---

## Local setup (foundation stage)

```bash
# from the repository root
docker compose up -d db      # start PostgreSQL 18
docker compose ps            # confirm it reports healthy

cd backend
cp .env.example .env         # local credentials only, never committed
npm run migration:status
npm run migration:up
```

The service is named `stockpilot-db`; the credentials above match
`docker-compose.yml`. An **empty schema apart from the migration helper and the
`pgmigrations` table** is expected at this stage.

```bash
docker compose exec db psql -U stockpilot -d stockpilot -c "\dt"
```

> **Not using Docker?** A native PostgreSQL 18 works equally well. Point the
> `PG*` variables in `backend/.env` at it, and create the role and database
> yourself — the migration tooling does not care how the server is provided.

---

## Quality gates

`database/migrations/` is covered by the same gates as the API, so a broken
migration cannot be committed unnoticed:

| Gate | Command (from `backend/`) | Covers migrations |
| --- | --- | --- |
| Type check | `npm run typecheck` | ✅ via `typecheck:migrations` |
| Lint | `npm run lint` | ✅ via `lint:migrations` |
| Build | `npm run build` | ✗ (migrations are tooling, not shipped code) |

Migrations are linted and type-checked by the same gates as the API, so a broken
migration cannot be committed unnoticed:

| Gate | Command (from `backend/`) | Covers migrations |
| --- | --- | --- |
| Type check | `npm run typecheck` | ✅ via `typecheck:migrations` |
| Lint | `npm run lint` | ✅ via `lint:migrations` |
| Build | `npm run build` | ✗ (migrations are tooling, not shipped code) |

`database/tsconfig.json` and `database/eslint.config.js` exist because the
migrations sit outside the `backend` package, where ESLint and TypeScript would
not otherwise reach them. Both borrow the TypeScript tooling from the single
`backend/node_modules` install, so **no duplicate dependencies are added**.

> **Maintenance note.** `database/tsconfig.json` maps the `node-pg-migrate` types
> to an explicit path inside `backend/node_modules`, because TypeScript cannot
> follow a package-directory reference for a bare specifier in ESM mode from a
> sibling package. If a future node-pg-migrate upgrade moves its bundled types,
> `npm run typecheck:migrations` fails loudly and that `paths` mapping is what
> needs updating.

---

## Troubleshooting

**`ECONNREFUSED` / `password authentication failed`**
`backend/.env` does not match the running server. Confirm with
`docker compose ps`, or `psql "postgresql://…"` using the same values.

**`ECONNREFUSED` but the database is up**
Check the `POSTGRES_PORT` mapping in `docker-compose.yml`; a non-default host port
means a non-default `PGPORT`.

**`schema "public" does not exist` / permission denied**
The role needs rights on the target database. Migrations create real objects —
`CREATE`, not read-only access.

**`Out-of-order migrations detected`**
`checkOrder` is doing its job: a new file sorts before ones already applied.
Rename the new migration so it sorts last, or reconcile with a corrective
migration. Never edit an applied file.

**`Another migration is running` (or the run appears to hang)**
`advisoryLockMode: 'wait'` blocks until the other runner finishes. Check for a
stale migration process before forcing anything.

**`must be a positive integer`**
`migration:down` takes a count: `npm run migration:down -- 2`.

**Type check fails on `node-pg-migrate`**
See the maintenance note above — update the `paths` mapping in
`database/migrations/tsconfig.json`.
