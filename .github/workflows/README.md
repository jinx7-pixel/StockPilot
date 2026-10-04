# GitHub Actions — StockPilot

CI/CD pipelines for StockPilot. Workflows live here as
`workflows/<workflow-name>.yml` and are committed; GitHub only runs workflows
present on the default branch.

## Workflows

| Workflow | Status | Trigger | Jobs |
| --- | --- | --- | --- |
| `ci.yml` | ✅ implemented | push to `main`, PR targeting `main` | `frontend`, `backend`, `migrations`, `backend-tests` |
| `docker.yml` | ⏳ planned | tag / release | build & push `frontend` / `backend` images — no Dockerfiles yet |
| `deploy.yml` | ⏳ planned | release or manual | deploy to a target environment — none chosen yet |

---

## `ci.yml` — Continuous Integration

The only workflow so far. It gates every change on four independent jobs that
run in parallel.

| Job | `working-directory` | Steps | Database |
| --- | --- | --- | --- |
| `frontend` | `frontend/` | `npm ci` → `lint` → `typecheck` → `build` | none |
| `backend` | `backend/` | `npm ci` → `lint` → `typecheck` → `build` | none |
| `migrations` | `backend/` | `npm ci` → `typecheck:migrations` → `lint:migrations` | none |
| `backend-tests` | `backend/` | `npm ci` → `npm test` | throwaway `postgres:18-alpine` service |

### Why `migrations` is a separate job

`database/migrations/` is its own TypeScript and ESLint project, living outside
the `backend` package. The backend's composite scripts already include it
(`lint` → `lint:migrations`, `typecheck` → `typecheck:migrations`), so the
`backend` job covers it too. The dedicated job runs those two steps **in
isolation** so that a future edit to a composite script cannot silently drop
migration coverage.

### `backend-tests` and the PostgreSQL service

The auth suite is database-backed, so this job declares a `postgres:18-alpine`
service container. Everything about it is deliberately throwaway:

- **CI-only credentials.** `POSTGRES_USER` / `POSTGRES_PASSWORD` are literals in
  the workflow. GitHub-hosted runners are discarded when the job ends, so these
  are **not secrets** and must never be reused for a real environment.
- **A separate database.** The suite creates and truncates `stockpilot_test`.
  `src/tests/setup.ts` refuses to start if `TEST_PGDATABASE` matches
  `PGDATABASE`, so a misconfigured runner cannot wipe development data.
- **No repository secrets at all.** Nothing in this workflow reads `secrets.*`.

The suite brings its own schema: the test bootstrap applies the committed
migrations to the test database, which also means the migrations themselves are
exercised on every run.

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

### No production database, no secrets

`migration:up` is deliberately **not** run against anything that matters. CI
never contacts a development, staging or production database, and no job reads a
repository secret. The only database CI ever touches is the per-job throwaway
container described above.

Applying migrations to a real environment belongs to a deploy step (CD), or to a
deliberate, reviewed operation — not to a pull request.

### When the service container grows

If tests later need extensions, a specific `POSTGRES_IMAGE`, or seeded data,
extend the `services.postgres` block. Keep the credentials CI-only and keep the
test database distinct from the application one.

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

# backend-tests job (needs a reachable PostgreSQL)
cd backend
cp .env.example .env   # set PG* to your local server; keep TEST_PGDATABASE distinct
npm ci && npm test
```

The test suite creates `TEST_PGDATABASE` if it is missing, applies the committed
migrations to it, and truncates it between tests. It refuses to run if
`TEST_PGDATABASE` equals `PGDATABASE`.

The one thing CI adds over a local run is a clean `node_modules` from `npm ci` —
running it locally at least once reproduces that.

## Conventions for future workflows

- Least-privilege `permissions:` on every workflow.
- Pinned action versions.
- Runtime configuration from repository **secrets** only, never hard-coded.
- `.env.example` files are the contract for which variables a job needs.
- Verify each workflow's equivalent commands locally before adding it here.
- Every step should genuinely fail the build when the thing it checks breaks —
  a green check that cannot go red is worse than no check.
