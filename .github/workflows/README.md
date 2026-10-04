# GitHub Actions — StockPilot

CI/CD pipelines for StockPilot. Workflows live here as
`workflows/<workflow-name>.yml` and are committed; GitHub only runs workflows
present on the default branch.

## Workflows

| Workflow | Status | Trigger | Jobs |
| --- | --- | --- | --- |
| `ci.yml` | ✅ implemented | push to `main`, PR targeting `main` | `frontend`, `backend`, `migrations` |
| `docker.yml` | ⏳ planned | tag / release | build & push `frontend` / `backend` images — no Dockerfiles yet |
| `deploy.yml` | ⏳ planned | release or manual | deploy to a target environment — none chosen yet |

---

## `ci.yml` — Continuous Integration

The only workflow so far. It gates every change on three independent jobs that
run in parallel.

| Job | `working-directory` | Steps |
| --- | --- | --- |
| `frontend` | `frontend/` | `npm ci` → `lint` → `typecheck` → `build` |
| `backend` | `backend/` | `npm ci` → `lint` → `typecheck` → `build` |
| `migrations` | `backend/` | `npm ci` → `typecheck:migrations` → `lint:migrations` |

### Why `migrations` is a separate job

`database/migrations/` is its own TypeScript and ESLint project, living outside
the `backend` package. The backend's composite scripts already include it
(`lint` → `lint:migrations`, `typecheck` → `typecheck:migrations`), so the
`backend` job covers it too. The dedicated job runs those two steps **in
isolation** so that a future edit to a composite script cannot silently drop
migration coverage.

### Design decisions

- **Runner** — `ubuntu-latest`, with a 10-minute `timeout-minutes` per job so a
  hung step cannot burn the quota.
- **Node 24** — the current *Active LTS* line, and comfortably above the
  `>=20.19.0` engine requirement in both packages. (Node 26 becomes Active LTS
  in late October 2026; bump `node-version` then, and re-run CI locally first.)
- **Dependency caching** — `actions/setup-node` with `cache: npm` and an explicit
  `cache-dependency-path` pointing at each package's `package-lock.json`.
- **`npm ci`, not `npm install`** — installs exactly the lockfile, so a
  lockfile that drifts from `package.json` fails the build instead of silently
  resolving new versions.
- **Actions pinned to exact release tags** (`checkout@v7.0.1`,
  `setup-node@v7.0.0`) rather than floating majors, so a run is reproducible.
  Bump them deliberately.
- **No third-party actions** — only `actions/*` first-party ones are used.
- **`permissions: contents: read`** — least privilege; CI never writes to the repo.
- **`concurrency`** — a new push to the same branch cancels the in-flight run
  instead of queueing behind it.

### No database, no secrets

**CI never contacts PostgreSQL and needs no credentials.** None of the steps
connect to a database: `lint` and `typecheck` are `eslint`/`tsc`, and `build` is
`tsc` + `vite build`. Nothing executes the application or the migration runner,
so there are no `secrets.*` references, no `env:` block and no `.env` file in the
runner.

`migration:up` is deliberately **not** run. Applying migrations needs a real
database with a real role, so it belongs to a deploy step (CD) or to a
dedicated database-backed test job — both of which come later.

### When to add a PostgreSQL service container

Once there are database-backed tests, add a `services:` block to the relevant
job using the official `postgres` image, with a **throwaway** CI-only password
supplied via the `env:` block (GitHub-hosted runners are ephemeral, so a fixed
non-secret literal is fine there — it is not a production credential). Do not
reuse a real database or a real secret.

---

## Reproducing CI locally

CI only runs commands that already exist, so the whole pipeline can be checked
before pushing:

```bash
# frontend job
cd frontend
npm ci && npm run lint && npm run typecheck && npm run build

# backend job
cd backend
npm ci && npm run lint && npm run typecheck && npm run build

# migrations job
cd backend
npm ci && npm run typecheck:migrations && npm run lint:migrations
```

The one thing CI adds is a clean `node_modules` from `npm ci` — running `npm ci`
locally at least once reproduces that.

## Conventions for future workflows

- Least-privilege `permissions:` on every workflow.
- Pinned action versions.
- Runtime configuration from repository **secrets** only, never hard-coded.
- `.env.example` files are the contract for which variables a job needs.
- Verify each workflow's equivalent commands locally before adding it here.
- Every step should genuinely fail the build when the thing it checks breaks —
  a green check that cannot go red is worse than no check.
