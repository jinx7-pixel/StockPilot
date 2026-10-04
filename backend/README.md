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
| `npm test` | Run the backend test suite (needs a reachable PostgreSQL) |
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
| `POST` | `/api/auth/register` | Creates a business + owner, signs in (`201`) |
| `POST` | `/api/auth/login` | Exchanges credentials for a session cookie |
| `POST` | `/api/auth/logout` | Revokes the session, clears the cookie |
| `GET` | `/api/auth/me` | Authenticated user + business (`401` when anonymous) |
| `GET` | `/api/products` | Paginated list — `search`, `categoryId`, `isActive`, `page`, `limit` |
| `POST` | `/api/products` | Create a product (`201`) |
| `GET` | `/api/products/:id` | One product |
| `PATCH` | `/api/products/:id` | Partial update |
| `DELETE` | `/api/products/:id` | **Soft delete** — deactivates and returns the product |
| `GET` | `/api/categories` | All categories, name-ordered |
| `POST` | `/api/categories` | Create a category (`201`) |
| `GET` | `/api/categories/:id` | One category |
| `PATCH` | `/api/categories/:id` | Partial update |
| `DELETE` | `/api/categories/:id` | Delete (`204`), **owner only**, refused while in use |
| `*` | *(unmatched)* | JSON `404` |

`/api/health` never touches the database, so a database outage cannot make the
HTTP process appear dead.

### Catalog rules

- **SKU** is trimmed and upper-cased, and unique per business
  (case-insensitive). Duplicates return `409`.
- **Category name** is unique per business, case-insensitive.
- **Money** is accepted as a number or decimal string, must be `0` or more with
  at most two decimal places, and is normalised to two decimals. No floating-point
  arithmetic is involved.
- **`categoryId` must belong to the caller's business.** A category from another
  tenant is rejected with `400` and a message that does not reveal whether it
  exists.
- **Listing** is paginated (default 25, max 100) with server-side ordering only.
  There is no user-controllable `ORDER BY` — the value cannot be parameterised,
  so accepting one would invite injection. A `%` in the search term is escaped and
  matches literally.
- **Deleting a product is a soft delete** (`is_active = false`), because inventory
  tables will soon reference it and hard deletion would destroy that history. It
  is reversible and idempotent.
- **Deleting a category is refused (`409`) while products reference it**, so
  products are never orphaned.

## Structure

```
src/
├── server.ts           # Process lifecycle, listen, graceful shutdown
├── app.ts              # Express app factory (separated for testability)
├── errors.ts           # Typed AppError hierarchy mapped to HTTP statuses
├── config/
│   ├── env.ts          # Validated env access
│   └── index.ts
├── db/
│   ├── config.ts       # Shared connection config (pool + migrations)
│   ├── pool.ts         # pg pool, query(), withTransaction(), checkConnection()
│   ├── migrate.ts      # Migration CLI (tooling only, not shipped)
│   ├── migrateConfig.ts# Shared runner config (CLI + tests)
│   └── index.ts
├── middlewares/
│   ├── asyncHandler.ts
│   ├── errorHandler.ts
│   ├── notFoundHandler.ts
│   ├── rateLimit.ts    # Credential-endpoint throttling
│   └── requireAuth.ts  # requireAuth + requireRole
├── repositories/       # All SQL lives here
│   ├── auth.types.ts
│   ├── business.repository.ts
│   ├── user.repository.ts
│   ├── session.repository.ts
│   ├── category.repository.ts
│   └── product.repository.ts
├── security/
│   ├── password.ts     # Argon2id hashing + policy
│   ├── session.ts      # Opaque token generation + hashing
│   └── cookies.ts      # HTTP-only cookie set/clear
├── services/
│   ├── auth.schemas.ts      # Zod request validation
│   ├── auth.service.ts      # register / login / logout / session resolution
│   ├── category.schemas.ts
│   ├── category.service.ts
│   ├── product.schemas.ts
│   └── product.service.ts
├── types/express.d.ts  # `req.auth` augmentation
└── routes/
    ├── index.ts        # apiRouter — mount new modules here
    ├── health.routes.ts
    ├── auth.routes.ts
    ├── category.routes.ts
    └── product.routes.ts
```

### Layering

`routes → services → repositories → db`, dependencies pointing inward only.
Business logic and SQL are strictly separated: services never see `req`/`res`,
repositories never contain business rules.

### Environment access

`src/config/env.ts` is the **only** module permitted to read `process.env`. It
validates once at import time and exports a typed, immutable `env` object, so a
missing variable fails fast at startup with a clear message instead of surfacing
as `undefined` inside a request.

## Authentication

Opaque session tokens in an HTTP-only cookie.

- **Passwords** are hashed with **Argon2id** (`@node-rs/argon2`, prebuilt
  binaries — no native toolchain needed) using the OWASP-recommended
  parameters: 19 MiB memory, 2 iterations, 1 lane, 32-byte output. Plaintext is
  never stored, and neither passwords nor hashes are ever logged.
- **Sessions** are 256-bit random tokens. The cookie carries the token; the
  database stores only its SHA-256 digest, so a database leak does not yield
  usable credentials. Server-side storage is what makes `logout` genuinely
  revoke access, and leaves room for refresh tokens later.
- **Cookies** are `HttpOnly` (invisible to JavaScript), `SameSite=Lax` and
  `Secure` in production. Nothing is written to `localStorage`.
- **Rate limiting** applies a 10-per-15-minutes limit to login, 5-per-hour to
  registration, and a broad 60-per-15-minutes backstop to the whole auth router.
- **No account enumeration**: an unknown email, a wrong password and an
  ambiguous email all return the same 401, and the "no such user" path spends
  comparable CPU so timing does not leak it either.

### Multi-tenancy

`requireAuth` is the single place a request gains an identity. It reads only the
session cookie, and the `businessId` it attaches is selected from the database
via a join — never from a request body, query parameter or header.
Repositories require an explicit `businessId` for any lookup driven by
client-supplied identity, so forgetting the tenant scope is a type error rather
than a silent cross-tenant leak.

`requireRole('owner')` guards owner-only actions and returns **403** to a signed-in
staff user (an anonymous caller still gets 401). It must always be mounted after
`requireAuth`, and asserts that if it isn't.

### Catalog permissions

| Action | Owner | Staff |
| --- | --- | --- |
| Read products / categories | ✅ | ✅ |
| Create and edit products / categories | ✅ | ✅ |
| Deactivate (soft-delete) a product | ✅ | ✅ |
| Delete a category | ✅ | ❌ `403` |

Staff manage the catalog day to day; only an owner retires a category, since
that is the operation that can be hardest to undo. The frontend mirrors these
rules by hiding the delete button for staff, so the UI never invites a call the
server will refuse.

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

`db/migrate.ts` and `db/migrateConfig.ts` are tooling only: they are excluded
from the production build and never imported by the running API.

## Testing

`npm test` runs the suite with the Node built-in test runner via `tsx` — no test
framework dependency.

```bash
cd backend
npm ci
npm test
```

The suite needs a reachable PostgreSQL. It:

- points itself at `TEST_PGDATABASE` (default `stockpilot_test`) and **refuses to
  run** if that matches `PGDATABASE`, because it truncates tables freely;
- creates the database if missing and applies the committed migrations to it;
- truncates between tests, and starts the real Express app on an ephemeral port
  so middleware, cookies and the database constraints are all exercised.

Test files run **serially** (`--test-concurrency=1`): they share one database, so
truncating in one while another registers would break foreign keys.

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
| `TEST_PGDATABASE` | `stockpilot_test` | Database used by `npm test` |
| `TRUST_PROXY` | `0` | Reverse-proxy hops to trust for the client IP |
| `SESSION_COOKIE_NAME` | `sp_session` | Session cookie name |
| `SESSION_TTL_DAYS` | `7` | Session lifetime |
| `COOKIE_SECURE` | `true` in production | Force/disable the Secure flag |
| `COOKIE_SAME_SITE` | `lax` | `lax` \| `strict` \| `none` |

`JWT_SECRET` and `OPENAI_API_KEY` are reserved for later milestones and are
intentionally blank.

---

See the [root README](../README.md), [`docs/architecture.md`](../docs/architecture.md)
and [`docs/getting-started.md`](../docs/getting-started.md).
