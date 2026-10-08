import { defineConfig } from 'vitest/config'

/**
 * Frontend test configuration.
 *
 * ## Why a separate file
 *
 * Deliberately kept out of `vite.config.ts` so the production build configuration
 * has no test-related code in it at all. `vite build` never reads this file, and
 * a test-only setting can never influence a production bundle.
 *
 * ## Why the `node` environment
 *
 * These tests exercise the transport and the API clients — the layer where the
 * production-readiness bug lived. That layer needs `fetch`, `Response` and
 * `import.meta.env`, all of which Node provides. Adding a DOM would buy nothing
 * here and would cost a dependency; component tests arrive with the UI/UX phase
 * and can switch this to `jsdom` in one line when they do.
 *
 * ## What these tests must never do
 *
 * They mock `fetch` at the boundary and make no network request, open no database
 * connection and start no server. They are therefore deterministic, instant, and
 * safe to run anywhere — including in CI with no services.
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Co-located with the source they cover: `request.test.ts` sits beside
    // `request.ts`, so the pair is obvious to anyone opening either file.
    include: ['src/**/*.test.ts'],
    // `rest` would otherwise be picked up by the other `include` patterns.
    exclude: ['node_modules/**', 'dist/**'],
    // Fail loudly rather than silently passing when a file has no tests.
    passWithNoTests: false,
  },
})