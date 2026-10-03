# StockPilot — Frontend

React 19 + TypeScript 6 + Vite 8 + Tailwind CSS 4.

This package is at the **foundation stage**: the toolchain is wired and verified,
and the app renders a shell that confirms the stack. No business features yet.

## Setup

```bash
cp .env.example .env.local   # local-only, git-ignored
npm install
npm run dev                  # http://localhost:5173
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR on port 5173 |
| `npm run typecheck` | `tsc -b` across the app and tooling tsconfigs |
| `npm run lint` | ESLint 10 flat config (`typescript-eslint`, `react-hooks`, `react-refresh`) |
| `npm run build` | Type-check, then production build to `dist/` |
| `npm run preview` | Serve the production build locally |

## Configuration

All variables live in `.env.example`; only `VITE_`-prefixed values reach the
browser bundle.

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | *(empty)* | API origin. Empty ⇒ use the dev proxy |
| `VITE_API_PROXY_TARGET` | `http://localhost:4000` | Where `/api` is proxied in dev/preview |
| `VITE_PORT` | `5173` | Dev server port |
| `VITE_PREVIEW_PORT` | `4173` | Preview server port |

> **Never put a secret in a `VITE_` variable.** Everything prefixed `VITE_` is
> compiled into the public client bundle.

## API access

`vite.config.ts` proxies `/api` to the backend during dev, so the app uses
**relative** `/api/...` paths — no hard-coded host, and no CORS locally. With the
API running, <http://localhost:5173/api/health> returns:

```json
{ "status": "ok", "service": "stockpilot-api" }
```

## Structure

```
src/
├── App.tsx      # Foundation shell
├── main.tsx     # React entry point
└── index.css    # Tailwind import + @theme design tokens
```

Tailwind 4 runs through the `@tailwindcss/vite` plugin — no `tailwind.config.js`
and no PostCSS config. Theme tokens live in `@theme` inside `index.css`.

## TypeScript

`tsconfig.json` uses project references:

- `tsconfig.app.json` — `src/`, DOM lib, bundler resolution, `noEmit`
- `tsconfig.node.json` — `vite.config.ts` and other build tooling

Strictness includes `noUnusedLocals`, `noUnusedParameters`,
`erasableSyntaxOnly` and `noFallthroughCasesInSwitch`.

---

See the [root README](../README.md), [`docs/architecture.md`](../docs/architecture.md)
and [`docs/getting-started.md`](../docs/getting-started.md).
