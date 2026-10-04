# Database — StockPilot

This directory owns the **PostgreSQL schema lifecycle** for StockPilot.

The schema is applied exclusively through **versioned, forward-only migrations**
run by [`node-pg-migrate`](https://node-pg-migrate.vercel.app/) — never by
hand-editing a live database, and never by application code that runs
`CREATE TABLE` at startup.

## Current status

The migration infrastructure is in place, along with the **authentication,
tenancy, catalog and stock-ledger schema**. The following tables are explicitly
**not** created:

`sales` · `sale_items` · `purchase_orders` · `purchase_order_items` ·
`stock_adjustments` · `recommendations` · `audit_logs`

| Migration | Contents |
| --- | --- |
| `1791027517242_shared-database-helpers` | `set_updated_at()` trigger helper |
| `1791101011378_auth-foundation` | `businesses`, `users`, the `user_role` enum |
| `1791101015605_auth-sessions` | `auth_sessions` |
| `1791113189231_products-catalog` | `categories`, `products` |
| `1791116341568_inventory-movements` | `inventory_movements`, the `inventory_movement_type` enum |
| Path | Purpose | Status |
| --- | --- | --- |
| `migrations/` | Versioned migrations (committed) | ✅ 5 migrations |
| `tsconfig.json` | Type-checks `migrations/` | ✅ present |
| `eslint.config.js` | Lints `migrations/` | ✅ present |
| `package.json` | Marks this directory as an ESM package | ✅ present |
| `seeds/` | Local-only development data | ⏳ reserved, not created yet |
| `../backend/src/db/migrate.ts` | Typed CLI wrapper around node-pg-migrate | ✅ present |
| `../backend/src/db/migrateConfig.ts` | Shared runner config (CLI + tests) | ✅ present |
| `../backend/src/db/config.ts` | Shared connection config (pool + migrations) | ✅ present |
| `../docker-compose.yml` | local PostgreSQL 18 service | ✅ present |

## Schema

### `businesses`

A tenant. Every user belongs to exactly one.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `name` | `varchar(150)` | not null |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` |

### `users`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `business_id` | `uuid` | not null → `businesses(id)` **ON DELETE CASCADE** |
| `name` | `varchar(100)` | not null |
| `email` | `varchar(255)` | not null, stored lower case |
| `password_hash` | `text` | not null, Argon2id |
| `role` | `user_role` | not null, default `staff` |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` |

Indexes and constraints:

- `users_business_id_idx` — every tenant-scoped query filters on this.
- `users_business_id_email_key` — **unique per business**, not globally. Two
  unrelated businesses may each register the same address.
- `users_email_lowercase_check` — `email = lower(email)`, so normalisation is
  guaranteed by the database and not merely by application code.
- `users_business_id_fkey` — deleting a business removes its users.

### `auth_sessions`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK |
| `user_id` | `uuid` | not null → `users(id)` **ON DELETE CASCADE** |
| `token_hash` | `text` | SHA-256 hex digest — never the raw token |
| `expires_at` | `timestamptz` | not null |
| `created_at` / `last_used_at` | `timestamptz` | not null, default `now()` |

Indexes: unique on `token_hash` (the lookup key for every request), plus
`user_id` and `expires_at` for session management and pruning.

### `categories`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `business_id` | `uuid` | not null → `businesses(id)` **ON DELETE CASCADE** |
| `name` | `varchar(100)` | not null |
| `description` | `text` | nullable |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` |

- `categories_business_id_idx`
- `categories_business_id_name_key` — **unique per business, case-insensitive**,
  an expression index on `(business_id, lower(name))` so uniqueness holds without
  lower-casing the display name.

### `products`

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `business_id` | `uuid` | not null → `businesses(id)` **ON DELETE CASCADE** |
| `category_id` | `uuid` | **nullable** → `categories(id)` **ON DELETE SET NULL** |
| `sku` | `varchar(100)` | not null, stored upper case |
| `name` | `varchar(200)` | not null |
| `description` | `text` | nullable |
| `unit` | `varchar(30)` | not null, default `piece` |
| `cost_price` | `numeric(12,2)` | not null, `>= 0` |
| `selling_price` | `numeric(12,2)` | not null, `>= 0` |
| `is_active` | `boolean` | not null, default `true` |
| `created_at` / `updated_at` | `timestamptz` | not null, default `now()` |

- `products_business_id_idx`, `products_category_id_idx`
- `products_business_id_name_idx` — supports the default `lower(name)` ordering
- `products_business_id_sku_key` — **unique per business, case-insensitive**, on
  `(business_id, upper(sku))`
- `products_cost_price_non_negative`, `products_selling_price_non_negative`

#### Why these columns — and what is deliberately absent

`products` holds **catalog definitions only**. There is no `stock_quantity`,
`available_quantity`, `reorder_point`, `stock_risk`, `demand` or `recommendation`
column, by design.

Those values must be **derived from stock movements**, not frozen on the product
row. Once the inventory module lands, quantities will change constantly; keeping
a mutable copy on the product would mean every sale, receipt or adjustment has to
keep two sources of truth in sync, and any drift would make "how much stock do I
have?" wrong in a way nothing could detect.

A catalog row answers *what is this product and what does it cost*; the future
inventory tables answer *how much is on hand, and is that a problem*. The API
reflects this: a product carries no stock fields, and a `stockQuantity` in a
create or update body is rejected as an unknown field.

### `inventory_movements` — the append-only stock ledger

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` | PK, default `gen_random_uuid()` |
| `business_id` | `uuid` | not null → `businesses(id)` **ON DELETE CASCADE** |
| `product_id` | `uuid` | not null → `products(id)` **ON DELETE NO ACTION** |
| `movement_type` | `inventory_movement_type` | not null — `in` \| `out` \| `adjustment` |
| `quantity` | `numeric(12,2)` | not null; sign rules below |
| `reason` | `varchar(255)` | nullable |
| `reference_type` | `varchar(50)` | nullable — e.g. `purchase_order` |
| `reference_id` | `uuid` | nullable |
| `created_by` | `uuid` | not null → `users(id)` **ON DELETE NO ACTION** |
| `created_at` | `timestamptz` | not null, default `now()` |

Indexes: `business_id`, `product_id`, `created_at`, plus
`(business_id, product_id, created_at DESC)` for the ledger read and
`(business_id, created_at DESC)` for tenant-wide activity.

#### The balance

```
stock = SUM(in.quantity) - SUM(out.quantity) + SUM(adjustment.quantity)
```

An adjustment carries its own sign, so it needs no special case. **There is no
`current_stock` column anywhere in the schema** — verified by a test, not just
by convention. A cached quantity would be a second source of truth that could
drift from the movements without anything detecting it.

#### Quantity rules (one CHECK constraint)

```sql
(movement_type = 'in'         AND quantity >  0) OR
(movement_type = 'out'        AND quantity >  0) OR
(movement_type = 'adjustment' AND quantity <> 0)
```

A negative `in`/`out` and a zero adjustment are therefore impossible even by
direct SQL, not merely by API validation.

#### Referential actions — why `NO ACTION` and not `RESTRICT`

`business → movements` cascades, but `product → movements` and
`user → movements` use the **`NO ACTION` default**. Both are needed:

- `NO ACTION` stops a product or user being deleted while movements reference
  it, so history cannot be orphaned and the audit trail keeps a real actor.
- `RESTRICT` would achieve that too, but it is checked *immediately*, which
  would break `DELETE FROM businesses`: the cascade to `products` fires that
  check before the cascade to `inventory_movements` has run, and deleting a
  tenant would start failing. `NO ACTION` is checked at end of statement, so the
  whole cascade completes and only a *direct* delete of a referenced row is
  refused.

This is verified directly against the database, not assumed.

#### Immutability

- `BEFORE UPDATE` trigger `inventory_movements_no_update` raises on any UPDATE.
  Safe to enforce at the storage layer: a cascading business delete only ever
  performs DELETE.
- **DELETE is not blocked by a trigger**, because the business cascade depends on
  it. Append-only is enforced instead by (a) the UPDATE trigger, (b) the absence
  of any `PATCH` or `DELETE` movement endpoint, and (c) the `NO ACTION` foreign
  keys. A correction is a **new** movement.

### Deletion behaviour

| Operation | Behaviour | Why |
| --- | --- | --- |
| Delete a **business** | cascades to categories and products | matches `users` / `auth_sessions` |
| Delete a **category** | **refused (409)** while products reference it | never orphan a product; reassign or remove them first |
| Delete a **product** | **soft delete** — sets `is_active = false` | see below |

**Why product deletion is a soft delete.** As soon as the inventory module
lands, products will be referenced by stock movements, adjustments, sales and
purchase orders. A hard delete would then either fail on a foreign key or — far
worse — cascade away financial history that must never disappear. Deactivating
keeps the catalog row, and therefore every past movement, intact; it is
reversible with `PATCH { isActive: true }` and idempotent. Hard deletion can be
introduced later, once the referencing tables exist and the trade-off is decided
knowingly.

### Tenancy

There is no membership join table: a user belongs to exactly one business. The
tenant (`business_id`) is read from the session via a database join and is never
taken from a request body, query parameter or header.

> **Known design tension.** Because email is unique *per business* rather than
> globally, the same address can exist in several tenants. `login` takes only an
> email and password, so more than one match is unresolvable — it fails closed
> with the same 401 as a wrong password. If that proves too strict in practice,
> the options are a global unique index on `email`, or a business identifier in
> the login payload. Both are deliberate product decisions, deferred.

## Layout

```
database/
├── migrations/
│   ├── 1791027517242_shared-database-helpers.ts
│   ├── 1791101011378_auth-foundation.ts
│   ├── 1791101015605_auth-sessions.ts
│   ├── 1791113189231_products-catalog.ts
│   └── 1791116341568_inventory-movements.ts
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
>
> Migrations also import only *types* from `node-pg-migrate`. They are loaded at
> runtime by jiti from outside the `backend` package, where a value import cannot
> be resolved — so SQL expressions go through `pgm.sql`.


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

### Migration-specific (used only by `npm run migration:*` and the test suite)

| Variable | Default | Purpose |
| --- | --- | --- |
| `PGSCHEMA` | `public` | Schema migrations run against |
| `PGMIGRATIONS_TABLE` | `pgmigrations` | Table recording applied migrations |
| `MIGRATIONS_DIR` | `../database/migrations` | Migration directory, relative to `backend/` |
| `TEST_PGDATABASE` | `stockpilot_test` | Database the automated tests use |

> Changing `PGMIGRATIONS_TABLE` or `PGSCHEMA` after migrations have run orphans
> the existing history. Leave them alone unless you intend to re-baseline.
>
> `TEST_PGDATABASE` must differ from `PGDATABASE`. The test bootstrap refuses to
> start if they match, because the suite truncates tables between tests.

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
| Tests | `npm test` | ✅ the suite applies the migrations to `TEST_PGDATABASE` |

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
