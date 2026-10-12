# syntax=docker/dockerfile:1

# =============================================================================
# StockPilot — frontend static assets, served by Nginx.
#
# The build stage compiles the SPA; the runtime stage is Nginx and nothing else.
# Node never reaches the final image.
#
# ## API base URL — resolved by design, not configuration
#
# `frontend/src/lib/request.ts` computes:
#
#     const BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '')
#
# `.dockerignore` excludes every `.env*` file, so `VITE_API_BASE_URL` is
# undefined inside this build and `BASE_URL` becomes `''`. The client then calls
# **relative** `/api/...` URLs, which resolve against its own origin and are
# proxied to the backend by `nginx.conf`.
#
# That is the behaviour we want: the image is environment-agnostic, the same
# artifact works behind any hostname, and no backend address — and certainly no
# credential — is ever baked into the JavaScript bundle.
#
# Note that `vite.config.ts` puts its `/api` proxy under `server:` (dev only);
# `preview:` has none. Neither applies here — Nginx owns the proxy in the image.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1 — build the static assets.
# -----------------------------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

# Manifests first so this layer survives source-only changes.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Everything `npm run build` (tsc -b && vite build) reads. Deliberately explicit:
# no `COPY . .`, so a future stray file cannot slip in unnoticed.
COPY frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
COPY frontend/vite.config.ts ./vite.config.ts
COPY frontend/index.html ./index.html
COPY frontend/src ./src

RUN npm run build

# -----------------------------------------------------------------------------
# Stage 2 — Nginx serving the compiled assets.
# -----------------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

# The stock image is configured to run as root. Everything below moves it to the
# built-in unprivileged `nginx` user instead of accepting root:
#   - port 8080, above the privileged range
#   - pid file and scratch paths under /tmp, writable by anyone
#   - logs to the container streams, not /var/log/nginx
#   - /etc/nginx/conf.d and the document root chowned, because the image's
#     entrypoint scripts write there on startup.
RUN touch /var/run/nginx.pid \
 && mkdir -p /var/cache/nginx /tmp/nginx \
 && chown -R nginx:nginx /var/run/nginx.pid /var/cache/nginx /etc/nginx/conf.d /tmp/nginx

COPY frontend/nginx.conf /etc/nginx/nginx.conf
COPY --from=build --chown=nginx:nginx /app/dist /usr/share/nginx/html

USER nginx

# Only the one port nginx actually listens on. PostgreSQL is never proxied here
# and no database port is exposed.
EXPOSE 8080

# Container-local check of *this* container only. It deliberately does not call
# /api/health or /api/ready: those are owned by the backend, and Nginx must
# report itself healthy whether or not the database is reachable.
#
# wget ships with alpine, so no extra package is needed.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/nginx-health || exit 1

CMD ["nginx", "-g", "daemon off;"]