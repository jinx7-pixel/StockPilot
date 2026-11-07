# StockPilot

**Inventory Intelligence Platform for Growing Businesses**

> Track inventory → understand risk → explain the problem → recommend the action →
> let the business owner decide.

StockPilot is built for small and mid-sized businesses that run on spreadsheets
and intuition. It does not simply record stock levels: it flags *risk*, explains
*why* something is at risk in plain language, recommends what to do about it, and
then stops — the decision stays with the owner.

![StockPilot dashboard showing sample inventory, sales and low-stock alerts](docs/images/dashboard-preview.jpg)

*Dashboard preview with sample data.*

---

## Description

Inventory problems in a growing business rarely arrive as a clean error. They
show up as a supplier delay, a demand spike, a slow-moving SKU quietly tying up
cash — and are usually discovered too late. StockPilot's value is not the
tracking itself, but the **interpretation layer on top of it**:

| Stage | What StockPilot does |
| --- | --- |
| **Track** | Tracks products, sales, supplier orders, and stock movements in one workspace. |
| **Understand risk** | Spots stockouts, overstock, dead stock and supplier exposure before they bite. |
| **Explain** | States the problem in plain language a non-technical owner can act on — no jargon. |
| **Recommend** | Suggests replenishment or a review of excess stock, slow-moving items, and supplier performance. |
| **Decide** | Presents options and trade-offs. The owner decides; the system advises. |

The design principle throughout: **decision support, not decision automation.**

### Non-goals

- Not a point-of-sale or accounting system — it integrates with them later.
- Not a generic BI dashboard — insight must lead to an action.
- Not autonomous purchasing — StockPilot never places orders on the owner's behalf.

---

## Tech Stack

| Layer | Technology |
| --- | --- |
| **Frontend** | React 19, TypeScript 6, Vite 8, Tailwind CSS 4 |
| **Backend** | Node.js 24 in CI and Docker, Express 5, TypeScript 5.9 |
| **Database** | PostgreSQL 18 |
| **Schema management** | node-pg-migrate (versioned, reversible migrations) |
| **API** | REST (JSON over HTTP, `/api/*`) |
| **Language** | TypeScript end to end (frontend + backend) |
| **Linting** | ESLint 10 flat config + `typescript-eslint` |
| **Package manager** | npm (separate dependency tree per package) |
| **Version control** | Git, GitHub |
| **CI** | GitHub Actions runs lint, type checks, tests, builds, and runtime dependency audits |
| **Containerization** | Docker images for the Nginx frontend and Express API. `docker-compose.prod.yml` runs the full stack for local rehearsal |
| **Local infrastructure** | `docker-compose.yml` runs PostgreSQL 18 for host-based development |

---

## Repository Structure

```
StockPilot/
├── frontend/                  # React + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── App.tsx            # Public, authentication, and workspace routes
│   │   ├── main.tsx
│   │   └── index.css          # Tailwind import + design tokens
│   ├── .env.example
│   ├── Dockerfile             # Vite build served by Nginx
│   ├── eslint.config.js
│   ├── tsconfig*.json
│   └── vite.config.ts         # Tailwind plugin + /api dev proxy
│
├── backend/                   # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── server.ts          # Process lifecycle, listen, graceful shutdown
│   │   ├── app.ts             # Express app factory (separated for testability)
│   │   ├── config/env.ts      # Validated env access (the only process.env reader)
│   │   ├── db/pool.ts         # pg connection pool — connection only, no schema
│   │   ├── middlewares/       # notFoundHandler, errorHandler
│   │   └── routes/            # Auth, inventory, analytics, and intelligence APIs
│   ├── .env.example
│   ├── eslint.config.js
│   └── tsconfig*.json
│
├── database/                  # Schema lifecycle
│   ├── migrations/            # Versioned node-pg-migrate migrations (committed)
│   ├── package.json           # Marks migrations as an ESM project
│   └── README.md              # Migration workflow and policy
│
├── docs/
│   ├── architecture.md        # Layering, request lifecycle, scaling path
│   └── getting-started.md     # Local setup and troubleshooting
│
├── .github/
│   └── workflows/
│       ├── ci.yml              # Frontend, backend and migration checks
│       └── README.md           # What CI does, and what is deliberately not in it
│
├── docker-compose.yml         # Local PostgreSQL 18 service
├── docker-compose.prod.yml    # Full-stack Docker rehearsal
├── Dockerfile                 # API and migration job images
├── .gitignore                 # Single source of truth for the monorepo
└── README.md
```

---

## What works today

- **Dashboard and analytics** show inventory balances, sales, and open purchase orders.
- **Products, inventory, and sales** use an append-only stock ledger. Sales and
  their stock movements commit together, with per-product locks to prevent overselling.
- **Suppliers and purchasing** support draft orders, marking orders as placed,
  and recording partial or full receipts.
- **Recommendations and Action Center** explain what needs review. After user
  approval, a replenishment recommendation can create a draft purchase order.
- **Workspace access** includes owner and staff roles, tenant isolation, email
  verification, password recovery, and optional authenticator-based two-step verification.

| Intelligence engine | What it reports |
| --- | --- |
| Stock Risk | Out-of-stock items and products at risk of running out |
| Demand Planning | Rising, falling, or stable demand based on sales history |
| Reorder | Whether stock needs replenishment and a suggested quantity when the data supports it |
| Overstock | Items holding more stock than recent demand warrants |
| Slow / Dead Stock | Items selling infrequently or holding stock with no recent sales |
| Supplier Intelligence | Observed lead times and consistency based on received orders |

Unified Intelligence combines the six engine results by product. Each
assessment includes its evidence and flags insufficient data where applicable.

---

## Continuous Integration

Every push to `main` and every pull request targeting `main` runs
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — four parallel jobs
on `ubuntu-latest` with Node 24 (current Active LTS):

| Job | Checks | Database |
| --- | --- | --- |
| `frontend` | `npm ci` → `lint` → `typecheck` → `build` | none |
| `backend` | `npm ci` → `lint` → `typecheck` → `build` | none |
| `migrations` | `npm ci` → `typecheck:migrations` → `lint:migrations` | none |
| `backend-tests` | `npm ci` → `npm test` | throwaway `postgres:18-alpine` service |

CI uses **no repository secrets**. The only database it touches is a per-job
throwaway container with CI-only credentials, seeded into a dedicated
`stockpilot_test` database that the suite creates and truncates. Actions are
pinned to exact release tags, `permissions` is least-privilege, and duplicate
runs for a branch are cancelled. Deployment is intentionally not part of CI; see
[`.github/workflows/README.md`](./.github/workflows/README.md) for the full
rationale and how to reproduce the pipeline locally.

---

## Quick Start

### Preview the dashboard

With Node.js 24, start the frontend and open
[the sample dashboard](http://localhost:5173/app?preview=1). This development
preview uses sample data and requires only the frontend.

```bash
npm ci --prefix frontend
npm run dev --prefix frontend
```

### Run the full application

```bash
# 1. Install
npm ci --prefix frontend
npm ci --prefix backend

# 2. Start the local database
docker compose up -d db

# 3. Copy the environment templates
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local

# Set PGPASSWORD=stockpilot_local_dev in backend/.env for the default local database.

# 4. Apply database migrations
cd backend && npm run migration:up && cd ..
# Provision stockpilot_app and create backend/.env.runtime as described below.

# 5. Run the API           (terminal 1 → http://localhost:4000)
cd backend && npm run dev:local

# 6. Run the web client    (terminal 2 → http://localhost:5173)
cd frontend && npm run dev
```

The API runs under the restricted `stockpilot_app` database role, configured in
the gitignored `backend/.env.runtime` — **complete that setup before step 5**.
Migrations (step 4) and the test suite keep using the owner/admin role from
`backend/.env`; they never read `.env.runtime`. See
[docs/getting-started.md](docs/getting-started.md#5-run-the-backend) for the full
procedure — including why a missing `.env.runtime` is a deliberate startup
failure, and why stray exported `PG*` variables can override it.

Set `APP_PUBLIC_URL` and the SMTP settings in `backend/.env.runtime` to
exercise registration, email verification, and password recovery. To run
the frontend, API, and PostgreSQL in containers, see the
[Docker rehearsal guide](docs/deployment.md#local-rehearsal).

Verify the API and migration status:

```bash
curl http://localhost:4000/api/health
# {"status":"ok","service":"stockpilot-api"}

cd backend && npm run migration:status
```

Full setup instructions and troubleshooting:
[`docs/getting-started.md`](./docs/getting-started.md).
Migration workflow: [`database/README.md`](./database/README.md).

---

## Database Migrations

The schema is applied **only** through versioned, forward-only migrations run by
[node-pg-migrate](https://node-pg-migrate.vercel.app/). No application code
creates or alters tables, and no credentials live in source control.

```bash
cd backend
npm run migration:create -- add-product-tables   # new timestamped migration
npm run migration:status                         # applied vs pending
npm run migration:up                             # apply pending
npm run migration:down                           # roll back the latest
npm run migration:redo                           # prove a down() works
```

Guarantees:

- **Append-only** — applied migrations are never edited or deleted; corrections
  ship as new migrations.
- **Reversible** — every migration has a `down`, guarded with `IF EXISTS`.
- **Safe to repeat** — `up` applies only pending migrations, in one transaction.
- **Order-checked** — an out-of-order migration fails loudly instead of corrupting
  history.
- **Deploy-safe** — concurrent runners serialise on a PostgreSQL advisory lock.
- **Same database as the API** — the pool and the migration runner share one
  connection config (`backend/src/db/config.ts`).
- **Quality-gated** — migrations are type-checked and linted by the same
  `npm run typecheck` / `npm run lint` used for the API.

**No business tables exist yet.** The single committed migration creates one
generic `set_updated_at()` helper and nothing else.

---

## Roadmap

Future work includes multi-location inventory, barcode scanning, notifications,
demand forecasting, and production deployment automation.

### Design principles

1. **Explain, don't just alert.** Every insight carries a human-readable reason.
2. **Recommend, never auto-execute.** The owner approves every action.
3. **Migrations only.** No application code creates or alters tables.
4. **Secrets stay out of source.** Configuration is environment-driven.
5. **Isolated sample data.** The dashboard preview and test fixtures use synthetic records.

---

## Security Notes

- `.env`, `.env.*` and common key/cert extensions are git-ignored; only
  `.env.example` templates are committed, containing placeholders only.
- Any variable prefixed `VITE_` is compiled into the **public** browser bundle
  and must never hold a secret.
- All SQL goes through parameterised queries in `db/pool.ts`; migrations use
  node-pg-migrate's parameterised builder, never string interpolation.
- CORS uses an explicit origin allow-list from `CORS_ORIGINS`, never `*`.
- Stack traces are never returned in production error responses.
- **Passwords** are hashed with Argon2id (OWASP parameters) and never logged;
  plaintext is never stored or returned.
- **Sessions** are 256-bit opaque tokens delivered in an `HttpOnly` cookie.
  JavaScript cannot read them, and nothing is stored in `localStorage`. Only a
  SHA-256 digest is persisted, so a database leak yields no usable credential.
- **Tenant scope** is always derived from the session, never from client input,
  and repositories require an explicit `businessId` for client-driven lookups.
- **Login** returns the same error for unknown emails and incorrect passwords.
  If legacy accounts share both an email and a password, users choose a
  workspace after verification. Signups and password resets use expiring,
  single-use email links. Account security supports authenticator codes, recovery
  codes, and signing out of all sessions.
- **Credential endpoints are rate limited**, and `TRUST_PROXY` must be set
  correctly in production or every client would share one bucket.

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | Layering, request lifecycle, module boundaries, scaling path |
| [`docs/getting-started.md`](./docs/getting-started.md) | Local setup, quality checks, troubleshooting |
| [`docs/deployment.md`](./docs/deployment.md) | Container topology, roles, probes, secrets, local rehearsal |
| [`database/README.md`](./database/README.md) | Migration workflow, environment variables, rollback, troubleshooting |
| [`database/migrations/README.md`](./database/migrations/README.md) | Migration file conventions and rules |

---

## License

StockPilot is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 jinx7-pixel. Third-party dependencies retain their respective licenses.
