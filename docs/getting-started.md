# Getting Started — StockPilot

Step-by-step local setup for the foundation stage. See
[`architecture.md`](./architecture.md) for how the pieces fit together.

## Prerequisites

| Tool | Version | Check |
| --- | --- | --- |
| Node.js | ≥ 20.19 (22 LTS or newer recommended) | `node -v` |
| npm | 10+ | `npm -v` |
| Git | any recent | `git --version` |
| Docker | any recent, for local PostgreSQL | `docker --version` |

Docker is needed only for the local database. If you already run PostgreSQL 18
locally, point `PG*` in `backend/.env` at it and skip the compose step.

## 1. Install dependencies

```bash
git clone <your-repo-url> stockpilot
cd stockpilot

npm install --prefix frontend
npm install --prefix backend
```

Frontend and backend have separate dependency trees on purpose.

## 2. Start the database

```bash
docker compose up -d db
docker compose ps        # expect STATUS "healthy"
```

This creates a PostgreSQL 18 container with local credentials
(`stockpilot` / `stockpilot` / `stockpilot_local_dev`) and a named volume
`stockpilot_pgdata`. An **empty schema is expected** at this stage.

```bash
docker compose logs -f db   # follow startup logs
docker compose down         # stop
docker compose down -v      # stop and delete all local data
```

## 3. Configure environment

Both apps read configuration from the environment; the committed
`.env.example` files are the contract.

```bash
# backend
cp backend/.env.example backend/.env

# frontend (Vite reads .env.local)
cp frontend/.env.example frontend/.env.local
```

The defaults in both templates already work for the local Docker database, so no
editing is required to start. `.env` and `.env.local` are git-ignored — never
commit them, and never put a real password or API key in the `.example` files.

## 4. Run the backend

```bash
cd backend
npm run dev
```

Expected output:

```
[stockpilot-api] listening on http://0.0.0.0:4000 (env: development)
[stockpilot-api] health check: http://localhost:4000/api/health
```

Verify:

```bash
curl http://localhost:4000/api/health
```

```json
{ "status": "ok", "service": "stockpilot-api" }
```

## 5. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Open <http://localhost:5173>. The StockPilot foundation page loads. The dev
server proxies `/api/*` to the backend, so
<http://localhost:5173/api/health> also returns the health JSON — a
one-command end-to-end check that both halves are wired together.

## 6. Quality checks

Run from each package directory.

```bash
# backend
cd backend
npm run typecheck   # tsc --noEmit, strict
npm run lint        # ESLint 10 flat config
npm run build       # emit dist/

# frontend
cd frontend
npm run typecheck   # tsc -b, app + tooling configs
npm run lint        # ESLint 10 + typescript-eslint + react-hooks
npm run build       # type-check then vite build -> dist/
npm run preview     # serve the production build locally
```

## Useful commands

| Purpose | Command |
| --- | --- |
| Backend dev with auto-reload | `cd backend && npm run dev` |
| Backend production run | `cd backend && npm run build && npm start` |
| Frontend dev with HMR | `cd frontend && npm run dev` |
| Frontend production preview | `cd frontend && npm run build && npm run preview` |
| Graceful API shutdown | `Ctrl+C` (SIGINT) — drains requests, closes the pool |

## Troubleshooting

**`EADDRINUSE: address already in use :::4000`**
Another process owns port 4000. Either stop it, or set `PORT` in
`backend/.env` (and match `VITE_API_PROXY_TARGET` in
`frontend/.env.local`).

**`Missing required environment variable: …`**
`config/env.ts` validates at startup on purpose. Copy the missing variable from
`backend/.env.example` into `backend/.env` rather than hard-coding a fallback in
source.

**`ECONNREFUSED` from the frontend**
The backend is not running, or the proxy target is wrong. Confirm
`http://localhost:4000/api/health` directly, then check
`VITE_API_PROXY_TARGET`.

**CORS errors**
`CORS_ORIGINS` in `backend/.env` must list the exact browser origin, e.g.
`http://localhost:5173` (scheme + host + port, no trailing slash). Note that with
the dev proxy in place, requests are same-origin and CORS is bypassed entirely.

**Database refuses connections**
`docker compose ps` should show `healthy`. If the container is restarting, run
`docker compose logs db`. Remember to delete the volume
(`docker compose down -v`) if you changed `POSTGRES_USER` or
`POSTGRES_PASSWORD` — the credentials live in the volume, not the compose file.
