# StockPilot

**Inventory Intelligence Platform for Growing Businesses**

> Track inventory → understand risk → explain the problem → recommend the action →
> let the business owner decide.

StockPilot is built for small and mid-sized businesses that run on spreadsheets
and intuition. It does not simply record stock levels: it flags *risk*, explains
*why* something is at risk in plain language, recommends what to do about it, and
then stops — the decision stays with the owner.

---

## Description

Inventory problems in a growing business rarely arrive as a clean error. They
show up as a supplier delay, a demand spike, a slow-moving SKU quietly tying up
cash — and are usually discovered too late. StockPilot's value is not the
tracking itself, but the **interpretation layer on top of it**:

| Stage | What StockPilot does |
| --- | --- |
| **Track** | Maintains a live, accurate picture of stock across locations, SKUs and movements. |
| **Understand risk** | Spots stockouts, overstock, dead stock and supplier exposure before they bite. |
| **Explain** | States the problem in plain language a non-technical owner can act on — no jargon. |
| **Recommend** | Proposes concrete next steps (reorder, defer, reallocate, renegotiate) with reasoning. |
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
| **Backend** | Node.js 22+, Express 5, TypeScript 5.9 |
| **Database** | PostgreSQL 18 |
| **Schema management** | node-pg-migrate (versioned, reversible migrations) |
| **API** | REST (JSON over HTTP, `/api/*`) |
| **Language** | TypeScript end to end (frontend + backend) |
| **Linting** | ESLint 10 flat config + `typescript-eslint` |
| **Package manager** | npm (separate dependency tree per package) |
| **Version control** | Git, GitHub |
| **CI/CD** | GitHub Actions — `ci.yml` (lint · typecheck · build). Deployment not implemented yet |
| **Containerization** | Docker — *planned for a later milestone* |
| **Local infrastructure** | `docker-compose.yml` (PostgreSQL 18 only) |

---

## Repository Structure

```
StockPilot/
├── frontend/                  # React + TypeScript + Vite + Tailwind
│   ├── src/
│   │   ├── App.tsx            # Foundation shell (no business features yet)
│   │   ├── main.tsx
│   │   └── index.css          # Tailwind import + design tokens
│   ├── .env.example
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
│   │   └── routes/            # /api/health (apiRouter + healthRouter)
│   ├── .env.example
│   ├── eslint.config.js
│   └── tsconfig*.json
│
├── database/                  # Schema lifecycle
│   ├── migrations/            # Versioned node-pg-migrate migrations (committed)
│   ├── package.json           # Marks migrations as an ESM project
│   └── README.md              # Migration workflow and policy (no business tables yet)
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
├── .gitignore                 # Single source of truth for the monorepo
└── README.md
```

---

## Current Development Status

**Stage: CI pipeline.** The toolchain is complete, verified and runnable, the
database schema can be versioned and rolled back, and every push and pull
request is now gated by GitHub Actions.
**No business functionality has been built yet** — by design.

### ✅ Complete

- Monorepo structure with `frontend/`, `backend/`, `database/`, `docs/`, `.github/workflows/`
- Frontend: React 19 + TypeScript 6 + Vite 8, Tailwind CSS 4 via `@tailwindcss/vite`
- Backend: Node.js + Express 5 + TypeScript, ESM, strict mode
- `GET /api/health` → `{"status":"ok","service":"stockpilot-api"}`
- Layered backend structure (`routes` → `middlewares` → `db` → `config`) with
  `createApp()` separated from `server.ts` for testability
- **Migration infrastructure**: node-pg-migrate wired through a typed CLI
  (`backend/src/db/migrate.ts`) with `create` / `up` / `down` / `redo` / `status`
- Migrations directory at `database/migrations/`, append-only, versioned and
  type-checked and linted alongside the API
- **Shared connection config** (`db/config.ts`) so the pool and the migration
  runner can never target different databases
- Migrations are transactional, order-checked and serialised with an advisory lock
- PostgreSQL connection configuration (`pg` pool from env vars) with transaction
  helper and graceful shutdown — **no tables created**
- Environment configuration via committed `.env.example` files; **no secrets in source**
- ESLint 10 flat config in both packages
- Root `.gitignore` covering Node, Vite, TypeScript, env files, logs, build
  output, database dumps and IDE files
- `docker-compose.yml` providing a local PostgreSQL 18 instance
- Verified `typecheck`, `lint`, and `build` in both packages; both servers start
  and the frontend dev proxy reaches the backend
- Migration tooling verified end to end against a live PostgreSQL 18
  (`status` → `up` → `redo` → `down`), with rollback confirmed at the SQL level
- **GitHub Actions CI** (`.github/workflows/ci.yml`): three parallel jobs —
  `frontend`, `backend`, `migrations` — each running `npm ci` then lint,
  type-check and build. No database, no secrets, no deployment
- Git repository initialised and pushed to `github.com/jinx7-pixel/StockPilot`

### ⏳ Not started (intentionally)

Authentication · Products · Inventory · Sales · Suppliers · Purchase Orders ·
Dashboard · AI/ML features · **Database business tables** · Seed data · Docker
images · **Deployment (CD)** · Automated tests

### Verification results

| Check | Backend | Frontend |
| --- | --- | --- |
| `npm run typecheck` | ✅ pass (app **and** migrations) | ✅ pass |
| `npm run lint` | ✅ pass (0 errors, 0 warnings) | ✅ pass (0 errors, 0 warnings) |
| `npm run build` | ✅ `dist/` emitted | ✅ `dist/` emitted |
| Server starts | ✅ port 4000 | ✅ port 5173 |
| `GET /api/health` | ✅ exact expected JSON | ✅ via `/api` proxy |
| `npm ci` (lockfile in sync) | ✅ clean install | ✅ clean install |
| `migration:up` / `redo` / `down` | ✅ verified live on PostgreSQL 18 | — |
| CI workflow YAML | ✅ parses; 40+ structural assertions pass | — |

---

## Continuous Integration

Every push to `main` and every pull request targeting `main` runs
[`.github/workflows/ci.yml`](./.github/workflows/ci.yml) — three parallel jobs
on `ubuntu-latest` with Node 24 (current Active LTS):

| Job | Checks |
| --- | --- |
| `frontend` | `npm ci` → `lint` → `typecheck` → `build` |
| `backend` | `npm ci` → `lint` → `typecheck` → `build` |
| `migrations` | `npm ci` → `typecheck:migrations` → `lint:migrations` |

CI needs **no database and no secrets** — nothing it runs touches PostgreSQL.
Actions are pinned to exact release tags, `permissions` is least-privilege, and
duplicate runs for a branch are cancelled. Deployment is intentionally not part
of CI; see [`.github/workflows/README.md`](./.github/workflows/README.md) for the
full rationale and how to reproduce the pipeline locally.

---

## Quick Start

```bash
# 1. Install
npm install --prefix frontend
npm install --prefix backend

# 2. Start the local database
docker compose up -d db

# 3. Configure environment (defaults already work locally)
cp backend/.env.example  backend/.env
cp frontend/.env.example frontend/.env.local

# 4. Apply database migrations
cd backend && npm run migration:up && cd ..

# 5. Run the API           (terminal 1 → http://localhost:4000)
cd backend && npm run dev

# 6. Run the web client    (terminal 2 → http://localhost:5173)
cd frontend && npm run dev
```

Verify the foundation end to end:

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

## Planned Modules

Each module is a future milestone. **None of these are implemented.**

| # | Module | Scope (planned) |
| --- | --- | --- |
| 1 | **Authentication & Users** | Owner/admin roles, sessions, onboarding, tenant isolation |
| 2 | **Products & Catalog** | SKUs, variants, units of measure, categories, barcodes, costing |
| 3 | **Inventory Tracking** | Stock levels per location, stock ledger, adjustments, cycle counts, low-stock thresholds |
| 4 | **Suppliers** | Supplier records, lead times, MOQs, pricing, performance and reliability history |
| 5 | **Purchase Orders** | Draft → approve → send workflow, PO lines, receiving, supplier acknowledgements |
| 6 | **Sales & Demand** | Sales history, demand signals, seasonality, forecast inputs |
| 7 | **Dashboard & Risk Insights** | Stockout / overstock / dead-stock detection, exposure summaries, prioritised action list |
| 8 | **Recommendations Engine** | Rule-based (and later ML) reorder, defer, reallocate and renegotiate suggestions with plain-language explanations |
| 9 | **AI/ML Layer** *(long-term)* | Demand forecasting, anomaly detection, natural-language explanations and summaries |
| 10 | **Platform & Operations** | Docker images, GitHub Actions CI/CD, observability, deployment, seed tooling |

### Guiding principles for these modules

1. **Explain, don't just alert.** Every insight carries a human-readable reason.
2. **Recommend, never auto-execute.** The owner approves every action.
3. **Migrations only.** No application code creates or alters tables.
4. **Secrets stay out of source.** Configuration is environment-driven.
5. **No mock business data in the repository.** Realistic data is seeded locally
   or generated by migrations fixtures, never committed as filler.

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

---

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/architecture.md`](./docs/architecture.md) | Layering, request lifecycle, module boundaries, scaling path |
| [`docs/getting-started.md`](./docs/getting-started.md) | Local setup, quality checks, troubleshooting |
| [`database/README.md`](./database/README.md) | Migration workflow, environment variables, rollback, troubleshooting |
| [`database/migrations/README.md`](./database/migrations/README.md) | Migration file conventions and rules |

---

## License

Private — all rights reserved. No licence has been granted yet.

**StockPilot** · Migration infrastructure stage · Built for growing businesses
that deserve clear answers about their stock.
