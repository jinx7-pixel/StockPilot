# Deployment — StockPilot

How the containerised stack fits together, and what is **not** safe to copy into
production. Read this before changing any environment variable below.

## Topology

```
        host
          │  http://localhost:8080        (the only published port)
   ┌──────▼───────────────────────────────────────────────┐
   │  internal compose network                             │
   │                                                       │
   │  frontend :8080 ──/api/──► api :4000 ──────► db :5432  │
   │  (nginx, non-root)     (no host port)  (no host port) │
   │                                                       │
   │  migrate (one-shot) ─────────────────────► db :5432   │
   └───────────────────────────────────────────────────────┘
```

| Service | Published | Notes |
|---|---|---|
| `frontend` | `8080` | Nginx; static assets + `/api/` proxy. `nginx.conf` upstream `api:4000` matches this service name. |
| `api` | none | Restricted runtime role. Reachable only through Nginx. |
| `db` | none | **Local rehearsal only.** Production should use managed PostgreSQL. |
| `migrate` | none | One-shot, opt-in profile. Owner role. Never on an API restart. |

Only Nginx talks to the API, which is what makes `TRUST_PROXY=1` true: exactly
one trusted hop. **Never set `TRUST_PROXY=true`** — that trusts the entire
`X-Forwarded-For` chain, letting any client forge its IP and therefore its rate
limit bucket.

## Local rehearsal

```bash
cp .env.compose.example .env.compose    # then fill in the two passwords
docker compose --env-file .env.compose -f docker-compose.prod.yml up -d db
docker compose --env-file .env.compose -f docker-compose.prod.yml run --rm migrate
docker compose --env-file .env.compose -f docker-compose.prod.yml exec db sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

In `psql`, [provision the runtime role](getting-started.md#provision-the-runtime-role)
with the username and password set in `PG_RUNTIME_USER` and
`PG_RUNTIME_PASSWORD`. Then exit `psql` and start the application.

```bash
docker compose --env-file .env.compose -f docker-compose.prod.yml up -d api frontend
curl -fsS localhost:8080/nginx-health
curl -fsS localhost:8080/api/health
curl -sS  localhost:8080/api/ready
curl -I   localhost:8080/app/inventory/anything   # SPA deep link -> 200
```

Tear down without touching data:

```bash
docker compose --env-file .env.compose -f docker-compose.prod.yml down      # keeps the named volume
docker compose --env-file .env.compose -f docker-compose.prod.yml down -v   # DELETES the volume
```

`down -v` destroys the database. Nothing in this repository runs it.

## Roles — two, and they are not interchangeable

| Role | Used by | Rights |
|---|---|---|
| `DB_ADMIN_*` | `migrate` job **only** | Owns the schema: CREATE, ALTER, TRIGGER, ownership |
| `PG_RUNTIME_*` | `api` | SELECT / INSERT / UPDATE / DELETE on application tables, including `auth_email_tokens` and `auth_attempts` |

The restricted role **cannot** create or alter objects. That is why migrations
use the owner role, and why widening the runtime role to make migrations work
would undo the least-privilege setup entirely.

## Liveness vs readiness — do not conflate them

| Endpoint | Meaning | Used by |
|---|---|---|
| `/api/health` | This process is alive. Dependency-free by design. | Docker `HEALTHCHECK`, `depends_on` |
| `/api/ready` | The database is reachable right now. Bounded at 2s; 503 otherwise. | Operators, load balancers |

Because the API healthcheck is *liveness*, `depends_on: api: service_healthy`
only guarantees the API process started. It does **not** mean the schema is
current. During a rollout, check `/api/ready` and the migration job's exit code
before routing traffic.

## Persistence is not backup

The `stockpilot_pgdata` volume survives `docker compose down`, and that is all
it does. Backups are an operational responsibility:

```bash
docker compose --env-file .env.compose -f docker-compose.prod.yml exec -T db sh -c 'exec pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > backup.sql
docker compose --env-file .env.compose -f docker-compose.prod.yml exec -T db sh -c 'exec psql -U "$POSTGRES_USER" "$POSTGRES_DB"' < backup.sql
```

A backup is only real once it has been **restored** somewhere and verified.

## Secrets

`.env.compose` is plain text on disk. It is acceptable for a local rehearsal and
**is not** secure secret storage — readable by anything running as your user, and
swept up by backup tooling. Production must inject the same variable *names*
from a platform secret store; the Compose file references names, never values.

`.dockerignore` excludes `**/.env*`, so `backend/.env` and
`backend/.env.runtime` cannot enter a build context or an image layer.

## Production security settings

The rehearsal is deliberately weaker. To deploy, change **all** of these, never
one at a time:

| | Rehearsal | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `PGSSLMODE` | `disable` | `verify-full` |
| `COOKIE_SECURE` | `false` | `true` |
| `CORS_ORIGINS` | `http://localhost:8080` | `https://…` |

Apply migrations with the schema owner before starting the updated API. If your
runtime role uses explicit per-table grants, grant access to the new tables
after migration. Substitute your runtime role if it uses a different name.

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON auth_email_tokens, auth_attempts TO stockpilot_app;
```

Set `APP_PUBLIC_URL` to the public HTTPS frontend origin in `CORS_ORIGINS`.
Configure SMTP with an authenticated sender and either mandatory STARTTLS on
port 587 or implicit TLS on port 465. Keep the same randomly generated
`MFA_ENCRYPTION_KEY` across API replicas and back it up in your secret store.
The API needs that key to read enrolled authenticator secrets. When the managed
database uses a private CA, mount its CA certificate and set `NODE_EXTRA_CA_CERTS`.
Configure HTTPS and HSTS at the public TLS terminator.

For local signup or recovery testing, set `APP_PUBLIC_URL` to your local
frontend origin and point SMTP at a sandbox mailbox. The automated tests use a
private in-memory outbox and do not contact SMTP. Existing users can verify
their email from **Account security** while signed in.

PostgreSQL 18 stores its data in a versioned directory under
`/var/lib/postgresql`. If upgrading a rehearsal previously using a mount at
`/var/lib/postgresql/data`, identify the actual data volume and take a verified
database backup before recreating the container. Restore the backup to the new
volume layout as needed.

`assertProductionSafe()` (`backend/src/config/env.ts`) enforces these at boot and
refuses to start otherwise. That is the intended behaviour — do not relax the
code's defaults to make a rehearsal work.

**Production also requires HTTPS.** With `COOKIE_SECURE=true` behind plain HTTP,
browsers will silently refuse to send the session cookie.

Production should drop the `db` service entirely and point `PGHOST` at managed
PostgreSQL, which brings backups, failover, PITR and certificates with it.

## Migrate stage

The `migrate` target in the root `Dockerfile` exists because the production
image cannot run migrations:

- `runtime` has no devDependencies; `tsx` and `node-pg-migrate` are dev-only.
- `src/db/migrate.ts` is excluded from the production build, so it is not in
  `dist/`.
- `migrateConfig.ts` resolves `MIGRATIONS_DIR` from two levels above `src/db`,
  which with `/app/src/db` is `/`, so `database/` is copied to `/database`. The
  compose job also sets `MIGRATIONS_DIR` explicitly so this does not depend on
  that arithmetic.

The image carries **no credentials** — they are injected at run time. It is
never published; `run --rm` builds and discards it.

Migrations are never automatic: not in the API entrypoint, not on restart, and
not in `docker compose up`. They run once, explicitly, and exit.

## Verification

```bash
docker compose -f docker-compose.prod.yml ps      # db and api must show no published port
docker inspect stockpilot-api-<id> | grep '"User"'   # expect node, not root
docker history --no-trunc stockpilot-api | grep -iE 'password|secret'   # expect empty
```
