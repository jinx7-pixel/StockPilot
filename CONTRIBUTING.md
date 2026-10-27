# Contributing to StockPilot

Thanks for contributing. StockPilot is a real application with a frontend, a
backend and a database, so the bar is higher than for a static site — but the
process below keeps changes reviewable and safe to deploy.

- [Quick start](#quick-start)
- [How to work on a change](#how-to-work-on-a-change)
- [Branch naming](#branch-naming)
- [Commit messages](#commit-messages)
- [Pull requests](#pull-requests)
- [Review guidelines](#review-guidelines)
- [Code style](#code-style)
- [Database changes](#database-changes)
- [Reporting bugs](#reporting-bugs)
- [What will not be merged](#what-will-not-be-merged)

---

## Quick start

StockPilot is a three-part application:

| Package | Stack | Purpose |
| --- | --- | --- |
| `frontend/` | React · TypeScript · Vite | Landing page and the app workspace |
| `backend/` | Express · TypeScript | REST API, auth, business logic |
| `database/` | TypeScript migrations | Schema, applied with the backend's migrator |

```bash
git clone https://github.com/jinx7-pixel/StockPilot.git
cd StockPilot

# frontend
cd frontend && npm ci && npm run dev

# backend, in a second terminal
cd backend && npm ci && npm run dev
```

Copy the example environment files and fill in the blanks:

```bash
cp frontend/.env.example frontend/.env
cp backend/.env.example  backend/.env
```

**Never commit a real `.env`.** The examples are the contract for which
variables exist; they are committed on purpose, the real files are not.

**Stack:** React · TypeScript · Vite · Vitest · ESLint · Express · PostgreSQL · Drizzle · Docker
**Tests:** `npm test` in `frontend/` and in `backend/`
**CI:** `.github/workflows/ci.yml` — four jobs (`frontend`, `backend`, `migrations`, `backend-tests`)

---

## How to work on a change

1. **Check for an existing issue**, or open one. Large changes need a discussion
   before the code, not after it.
2. **Branch off `main`.** Never commit directly to `main`.
3. **Write the change.** Keep it as small as it can be while still solving the
   problem.
4. **Run the full local check** — the same commands CI runs:
   ```bash
   cd frontend && npm ci && npm run lint && npm run typecheck && npm test && npm run build
   cd ../backend && npm ci && npm run lint && npm run typecheck && npm run build
   ```
   The backend test suite needs a reachable PostgreSQL. Point `PG*` at your
   local server and keep `TEST_PGDATABASE` distinct from `PGDATABASE` — the
   suite refuses to run if they match, and it truncates the test database
   between tests.
5. **Open a pull request** and describe what changed and why.
6. **Respond to review.** Push fixes as new commits on the same branch.

---

## Branch naming

| Prefix | Use it for | Example |
| --- | --- | --- |
| `feature/` | New functionality | `feature/overstock-alerts` |
| `fix/` | A bug fix | `fix/session-cookie-expiry` |
| `docs/` | Documentation only | `docs/deployment-troubleshooting` |
| `refactor/` | No behaviour change | `refactor/repository-layer` |
| `perf/` | Performance work | `perf/index-inventory-lookup` |
| `test/` | Tests only | `test/intelligence-regression-suite` |
| `chore/` | Tooling, dependencies, CI | `chore/bump-node-to-26` |

Rules:

- Lowercase, hyphen-separated.
- One branch, one concern.
- Delete the branch after merging.
- Rebase on `main` before requesting review:
  ```bash
  git fetch origin
  git rebase origin/main
  ```

---

## Commit messages

[Conventional Commits](https://www.conventionalcommits.org/).

```
<type>(optional scope): <short summary in the imperative mood>

<optional body>

<optional footer>
```

| Type | Use it for |
| --- | --- |
| `feat` | New user-visible functionality |
| `fix` | A bug fix |
| `docs` | Documentation only |
| `style` | Formatting only — no behaviour change |
| `refactor` | Restructure with no behaviour change |
| `perf` | Performance improvement |
| `test` | Adding or correcting tests |
| `build` | Build system or dependency changes |
| `ci` | Workflow changes |
| `chore` | Maintenance that fits nothing else |

Scopes used in this repository: `frontend`, `backend`, `database`, `auth`,
`intelligence`, `inventory`, `analytics`, `docs`, `docker`.

```
feat(intelligence): add overstock risk scoring
fix(auth): clear the session cookie on logout
refactor(backend): extract the pool into its own module
test(inventory): cover the movement posting path
```

Rules:

- Imperative mood, no trailing full stop, 72 characters or fewer on the subject.
- One logical change per commit.
- Body explains **why** when it is not obvious.
- `Fixes #123` closes an issue automatically.

---

## Pull requests

Before requesting review, confirm:

- [ ] `npm run lint` passes in `frontend/` and `backend/`.
- [ ] `npm run typecheck` passes in both.
- [ ] `npm test` passes in both, and new behaviour has new tests.
- [ ] `npm run build` succeeds in both.
- [ ] `npm run typecheck:migrations` and `npm run lint:migrations` pass if you
      touched `database/migrations/`.
- [ ] The PR description explains **what** changed and **why**.
- [ ] Screenshots are attached for any UI change.
- [ ] No secrets, `.env` files, credentials, or production data are included.
- [ ] The diff contains no unrelated reformatting.

### Review guidelines

Reviewers check, in this order:

1. **Correctness** — does it do what it says? Does it break anything else?
   For a bug fix, is there a regression test that fails without the fix?
2. **Scope** — is the change limited to what it claims?
3. **Data integrity** — for anything touching `database/migrations/`, are the
   migration and the code that depends on it consistent? Is the migration
   reversible, or is that a deliberate, documented decision?
4. **Security** — new endpoints need authorisation, input validation, and rate
   limiting. New queries need parameterisation. Secrets come from the
   environment, never from a literal in the code.
5. **Tests** — does the suite actually cover the new path? A green check that
   cannot go red is worse than no check.
6. **Consistency** — does it match the existing module layout, naming, and
   error-handling style?

**How to review:**

1. Read the description, then the diff.
2. Run the affected package's checks locally before approving.
3. Comment on the code, not the person.
4. Request changes only for things that matter. Say plainly when a PR is good
   enough to merge.
5. Approve when the change is correct and maintainable. A review is not a
   negotiation.

**Who merges:** the repository owner. One approval plus green CI is enough.

---

## Code style

**TypeScript**

- Strict mode is already on. Do not weaken it with `any` — use `unknown` and
  narrow, or a precise type.
- `const` by default; `let` only when reassigned; never `var`.
- `interface` for object shapes that may be extended, `type` for unions and
  mapped types. Be consistent within a file.
- `import type` for type-only imports.
- Prefer `async`/`await` over raw promise chains.
- No default exports in modules that export more than one thing.

**ESLint**

- The config is flat (`eslint.config.js`) in both packages. Run
  `npm run lint` before pushing. Do not add inline disable comments to silence
  a rule without a short comment explaining why.

**React**

- Function components only. No class components.
- Hooks at the top level of a component, never inside a condition or a loop.
- `useCallback` / `useMemo` only when there is a measured reason, not
  speculatively.
- Components that render UI go in `frontend/src/components/`; page-level
  components go in `frontend/src/pages/`.
- A component and its test live side by side: `Button.tsx` and
  `Button.test.tsx`.

**Backend**

- Layering is fixed: `routes` → `services` → `repositories` → `db`.
  - `routes` parse and validate the request, and nothing else.
  - `services` hold the business logic.
  - `repositories` touch the database.
  - A route must not contain SQL, and a repository must not contain business
    rules.
- Input is validated at the edge, with the schemas in
  `backend/src/services/*.schemas.ts`.
- Every new endpoint needs authentication, authorisation, validation, and rate
  limiting.
- Errors go through the shared error handler. Do not `throw` raw `Error`
  objects from a service.

**Naming**

- Files are `camelCase.ts` for modules and `PascalCase.tsx` for components.
- `*.routes.ts` · `*.service.ts` · `*.schemas.ts` · `*.repository.ts` — the
  suffix says what the file is, and it must match the folder it sits in.

---

## Database changes

Migrations live in `database/migrations/` and are applied by the backend
migrator. They are part of the project, not a side script.

- A schema change needs a migration in the same PR as the code that uses it.
- Use the timestamp-prefixed naming already in the folder:
  `1791027517242_shared-database-helpers.ts`.
- Migrations must be runnable against a fresh database and against a populated
  one.
- Never edit a migration that has already been merged. Add a new one.
- CI applies the committed migrations to a throwaway database on every run, so
  a broken migration fails the build.

---

## Reporting bugs

Use the **Bug report** issue template. Include the package (`frontend`,
`backend`, `database`), the route or component, the exact steps, and the
observed versus expected behaviour. Attach the relevant console or server
output with secrets removed.

Security vulnerabilities should **not** be opened as public issues. Follow
[SECURITY.md](SECURITY.md).

---

## What will not be merged

- A change that fails CI.
- A change with no tests for new behaviour.
- A route without validation, authentication, or rate limiting.
- A hardcoded secret, API key, password, or connection string.
- A real `.env` file, or production data, in the repository.
- A `package-lock.json` edited by hand.
- Formatting churn mixed into a behavioural change — split it out.
- A migration that edits an already-merged migration file.
- A commit message of `.wq` / `wq` / `Merge branch 'main' of …` with no
  meaningful description.

---

## Code of Conduct

Participation in this project is governed by
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Licence

See [LICENSE](LICENSE).
