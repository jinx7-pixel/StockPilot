# syntax=docker/dockerfile:1

# =============================================================================
# StockPilot API — backend image
#
# Backend only. The frontend is a static-asset image and is built separately.
#
# Three properties this file exists to guarantee:
#
#   1. **No secret is ever baked in.** `.env` and `.env.runtime` are excluded by
#      `.dockerignore`; every runtime value is injected as an environment
#      variable when the container starts. There are no defaults here for
#      anything that could authenticate.
#   2. **Dependencies are installed inside the image.** `@node-rs/argon2` is a
#      native module whose binary is platform-specific. Copying a host's
#      `node_modules` would ship a Windows binary into Linux; `npm ci` here
#      resolves the correct optional dependency for this image's platform.
#   3. **Migrations are not an entrypoint.** `npm start` runs the API only.
#      `src/db/migrate.ts` is excluded from `tsconfig.build.json`, so it is not
#      even compiled into the image — migrations are a separate job that runs
#      from the source tree before the API starts.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — dependency install, cached independently of source changes.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS deps

WORKDIR /app

# Manifests first: this layer is reused until a dependency actually changes.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# -----------------------------------------------------------------------------
# Stage 2 — compile TypeScript to dist/.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules

# Only the configs and sources the build reads; tsconfig.json includes only "src",
# so database/ and frontend/ are never needed here.
COPY backend/tsconfig.json backend/tsconfig.build.json ./
COPY backend/src ./src

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 3 — production dependencies only (no devDependencies, no compiler,
# no test tooling).
# -----------------------------------------------------------------------------
FROM node:20-alpine AS prod-deps

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# -----------------------------------------------------------------------------
# Stage 4 — runtime.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS runtime

# NODE_ENV=production activates assertProductionSafe(), which refuses to start
# without a real database host, database name, role, TLS, a secure cookie, an
# explicit CORS origin list and TRUST_PROXY. That fail-fast behaviour is the
# point: a misconfigured deployment should not boot and then behave unsafely.
#
# HOST/PORT are not secrets and are overridable at run time.
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4000

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build     --chown=node:node /app/dist ./dist
COPY --chown=node:node backend/package.json ./

# Never root.
USER node

EXPOSE 4000

# Liveness only, matching the existing contract: dependency-free by design, so a
# database outage cannot make Docker restart a healthy process. Readiness is a
# separate concern (/api/ready) for orchestrators to use.
#
# Uses Node's own fetch rather than curl or wget, so the image needs no extra
# package for its health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Plain `node dist/server.js`, never `start:local`: that script depends on a
# local .env.runtime file which must not exist in an image.
#
# Node runs as PID 1 here and registers its own SIGTERM handler, so graceful
# shutdown (stop the session-cleanup job and drain it, close the server, drain
# the pool) runs on `docker stop`.
CMD ["node", "dist/server.js"]

# -----------------------------------------------------------------------------
# Stage 5 — migration job.
#
# Deliberately NOT derived from `runtime`:
#
#   - `runtime` has no devDependencies, and migrations need `tsx` and
#     `node-pg-migrate`, which are devDependencies.
#   - `runtime` has no TypeScript source, and `src/db/migrate.ts` is excluded
#     from the production build, so it is not in `dist/`.
#
# `migrateConfig.ts` resolves the default MIGRATIONS_DIR from two levels above
# `src/db`. With the layout below that is `/`, so the relative default lands on
# `/database/migrations` — which is exactly where `database/` is copied. Setting
# MIGRATIONS_DIR explicitly in the compose job makes that independent of this
# arithmetic.
#
# This image carries NO credentials. They are injected at run time, so they are
# never a build layer. It is also never published — `docker compose run --rm
# migrate` builds it on demand and throws it away.
#
# It runs as tooling, not as a served process, so NODE_ENV is left unset:
# `assertProductionSafe()` only applies to a served production API.
FROM node:20-alpine AS migrate

WORKDIR /app

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json ./tsconfig.json
COPY backend/src ./src
COPY database /database

# Fails loudly if MIGRATIONS_DIR is wrong, instead of silently migrating nothing.
RUN test -d /database/migrations

CMD ["npm", "run", "migration:up"]