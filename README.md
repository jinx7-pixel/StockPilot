# StockPilot

StockPilot helps small and midsize businesses manage inventory, sales, and purchasing
in one workspace. It shows which products need attention, explains the evidence,
and recommends a next step. The owner decides what to do.

[Try the dashboard preview](#quick-start) · [Local setup](docs/getting-started.md) · [MIT License](LICENSE)

![StockPilot dashboard showing sample inventory, sales, and stock alerts](docs/images/dashboard-preview.jpg)

*Dashboard preview with sample data.*

## How StockPilot works

| Step | What happens |
| --- | --- |
| Track | Products, stock movements, sales, and supplier orders are recorded in a workspace. |
| Assess | Inventory engines evaluate stock levels, sales history, and supplier receipts. |
| Explain | Each assessment shows its evidence and identifies products that need attention. |
| Recommend | The Action Center suggests what to review or replenish. |
| Decide | The owner reviews the recommendation and approves any action. |

## What works today

- **Dashboard and analytics:** See inventory balances, sales trends, and open purchase orders.
- **Inventory and sales:** Manage a product catalog and track adjustments and sales
  in an append-only stock ledger.
- **Suppliers and purchasing:** Draft purchase orders, mark them as placed, and
  record partial or full receipts.
- **Action Center:** Review recommendations and turn an approved replenishment
  action into a draft purchase order.
- **Workspace access:** Sign in to a workspace with owner and staff roles and
  business-scoped data.

| Intelligence engine | What it reports |
| --- | --- |
| Stock Risk | Items already out of stock or at risk of running out |
| Demand Planning | Rising, falling, or stable demand based on sales history |
| Reorder | Whether to replenish and a suggested quantity when the data supports one |
| Overstock | Items holding more stock than recent demand warrants |
| Slow / Dead Stock | Items selling slowly or holding stock with no recent sales |
| Supplier Intelligence | Observed lead times and delivery consistency |

Unified Intelligence combines the six engine results by product and shows the
evidence behind each assessment. It flags insufficient data instead of guessing.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19, TypeScript 6, Vite 8, and Tailwind CSS 4 |
| Backend | Node.js, Express 5, and TypeScript 5.9 |
| Data | PostgreSQL 18 with versioned node-pg-migrate migrations |
| API | JSON over HTTP under `/api/` |
| Tooling | npm, ESLint 10, Vitest, and the Node.js test runner |
| Containers | Nginx for the frontend, Node.js for the API, and a separate migration image |
| CI | GitHub Actions with Node.js 24 |

## Architecture

```text
Browser → React frontend → Express routes → services → repositories → PostgreSQL
```

Routes validate HTTP input and delegate to services. Services enforce business
rules, and repositories handle database queries. `app.ts` builds the Express
application for both the running server and tests. `server.ts` starts the
listener and handles shutdown. See the [architecture guide](docs/architecture.md)
for module boundaries and the request lifecycle.

Stock balances are derived from the inventory ledger. Recording a sale writes
the sale, its line items, and the stock movements in one transaction. Locks on
the affected products protect stock when two sales run concurrently. The
intelligence engines read stock, sales, and purchasing data and pass assessments
to Unified Intelligence and the Action Center.

## Quick start

Use Node.js 24 and npm. The dashboard preview needs only the frontend; it uses
sample data and requires no sign-in or database.

```bash
git clone https://github.com/jinx7-pixel/StockPilot.git
cd StockPilot
npm ci --prefix frontend
npm run dev --prefix frontend
```

Open [localhost:5173/app?preview=1](http://localhost:5173/app?preview=1).

### Run the full application

1. Install the frontend and backend dependencies from the repository root.

   ```bash
   npm ci --prefix frontend
   npm ci --prefix backend
   ```

2. Use a local PostgreSQL 18 instance with a development database owned by a
   migration role, or start the development database with `docker compose up -d db`.
   Copy `backend/.env.example` to `backend/.env` and `frontend/.env.example` to
   `frontend/.env.local`. Set `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and
   `PGPASSWORD` in the backend file to match your local database and migration role.

3. Apply the migrations from the repository root.

   ```bash
   npm run migration:up --prefix backend
   npm run migration:status --prefix backend
   ```

4. Provision the runtime role and put its connection settings in the gitignored
   `backend/.env.runtime`. The two roles have different jobs.

   | Role | Used for | Access |
   | --- | --- | --- |
   | Database owner | Migrations and database tests through `backend/.env` | Can create and alter database objects |
   | `stockpilot_app` | API startup through `backend/.env.runtime` | Can access application tables with explicit grants |

   On a fresh local `stockpilot` database, run the following from `psql` as the
   schema owner after applying migrations. `\password` prompts for a password.

   ```sql
   CREATE ROLE stockpilot_app LOGIN;
   \password stockpilot_app
   GRANT CONNECT ON DATABASE stockpilot TO stockpilot_app;
   GRANT USAGE ON SCHEMA public TO stockpilot_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON
     businesses, users, auth_sessions, categories, products, inventory_movements,
     sales, sale_items, suppliers, purchase_orders, purchase_order_items, actions
     TO stockpilot_app;
   ```

   If the role already exists, apply the grants with your database and role names.
   Set the `PG*` connection values in `backend/.env.runtime`, using `PGUSER=stockpilot_app`
   and its password. Shell variables take precedence over this file. See the
   [runtime role setup](docs/getting-started.md#5-run-the-backend) for the file layout.

5. Start the API and web client in separate terminals from the repository root.

   ```bash
   npm run dev:local --prefix backend
   ```

   ```bash
   npm run dev --prefix frontend
   ```

   Open [localhost:5173](http://localhost:5173/) and check the API at
   [localhost:4000/api/health](http://localhost:4000/api/health). The health
   endpoint reports whether the API is running. `/api/ready` checks database readiness.

### Docker

Docker support is already in the repository:

| File | Purpose |
| --- | --- |
| [`docker-compose.yml`](docker-compose.yml) | PostgreSQL for development with the frontend and API running on the host |
| [`frontend/Dockerfile`](frontend/Dockerfile) | Builds the React frontend and serves it with Nginx |
| [`Dockerfile`](Dockerfile) | Builds the API and the separate migration job |
| [`docker-compose.prod.yml`](docker-compose.prod.yml) | Runs the frontend, API, PostgreSQL, and opt-in migration job for a local rehearsal |

See the [deployment guide](docs/deployment.md) for the container layout.
[PR #3](https://github.com/jinx7-pixel/StockPilot/pull/3) updates the
instructions and configuration for starting the container stack on a fresh database.

## Project layout

```text
StockPilot/
├── frontend/
│   ├── src/pages/             # Public, authentication, and workspace pages
│   ├── src/components/        # Shared UI and dashboard components
│   ├── Dockerfile             # Vite build served by Nginx
│   └── vite.config.ts         # Development server and API proxy
├── backend/
│   ├── src/app.ts             # Express application factory
│   ├── src/server.ts          # Server startup and shutdown
│   ├── src/routes/            # HTTP endpoints
│   ├── src/services/          # Business logic
│   ├── src/repositories/      # Database access
│   ├── src/intelligence/      # Inventory assessments and recommendations
│   └── src/tests/             # Backend tests and fixtures
├── database/migrations/       # Versioned database changes
├── docs/                      # Architecture, setup, and deployment guides
├── .github/workflows/ci.yml    # GitHub Actions CI
├── docker-compose.yml         # PostgreSQL for local development
├── docker-compose.prod.yml    # Full stack container rehearsal
└── Dockerfile                 # API and migration images
```

## Database migrations

Migrations create and update the schema for workspaces, users, the catalog,
stock movements, sales, purchasing, and the Action Center. The API uses a
restricted role. Run migrations separately using the database owner.

| Command in `backend/` | Purpose |
| --- | --- |
| `npm run migration:create -- describe-change` | Create a timestamped migration file |
| `npm run migration:status` | List applied and pending migrations |
| `npm run migration:up` | Apply pending migrations |
| `npm run migration:down` | Roll back the latest migration |
| `npm run migration:redo` | Roll back and reapply the latest migration on a development database |

Keep applied migrations unchanged and add a new file for each schema change.
Migration type checks and linting run in CI. See the
[migration workflow](database/README.md) and [file conventions](database/migrations/README.md).

## Continuous integration

[GitHub Actions](.github/workflows/ci.yml) runs on pushes to `main` and pull
requests targeting it. The jobs use Node.js 24.

| Job | Checks |
| --- | --- |
| Frontend | Install, lint, type check, run Vitest, and build the web client |
| Backend | Install, lint, type check, and build the API |
| Migrations | Type check and lint migration files |
| Backend tests | Run the backend suite against a disposable PostgreSQL 18 service |

The backend tests use a dedicated `stockpilot_test` database. For the local test
commands and prerequisites, see the [CI guide](.github/workflows/README.md).

## Security notes

- Passwords use Argon2id hashing. Sessions use opaque tokens in `HttpOnly` cookies,
  and the database stores SHA-256 digests of those tokens.
- The session supplies the workspace ID used by scoped repositories. Owner and
  staff roles govern access to workspace operations.
- Credential endpoints have rate limits. Set `TRUST_PROXY` to match your reverse
  proxy setup and list your web origins in `CORS_ORIGINS`.
- Use the database owner for migrations and a restricted role for the running API.
- Keep passwords and connection strings in local environment files or a secret
  store. Values prefixed with `VITE_` are visible in the browser bundle.

## Roadmap

Planned work includes multi-location inventory, barcode scanning, notifications,
demand forecasting, and deployment automation.

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting started](docs/getting-started.md) | Local setup, runtime configuration, and troubleshooting |
| [Architecture](docs/architecture.md) | Request lifecycle, module boundaries, and workspace isolation |
| [Deployment](docs/deployment.md) | Container topology, roles, and health checks |
| [Database](database/README.md) | Migrations, credentials, and rollback |
| [CI](.github/workflows/README.md) | Workflow jobs and local verification |

## License

StockPilot is licensed under the [MIT License](LICENSE).
