import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

/**
 * Frontend test configuration.
 *
 * ## Why a separate file
 *
 * Deliberately kept out of `vite.config.ts` so the production build configuration
 * has no test-related code in it at all. `vite build` never reads this file, and a
 * test-only setting can never influence a production bundle.
 *
 * ## Two environments, on purpose
 *
 * - **`jsdom`** is the default, because component tests need a DOM: focus
 *   behaviour, `role`/`aria-*` queries and keyboard events cannot be exercised in
 *   Node.
 * - The three transport/API suites opt back into **`node`** with an explicit
 *   `@vitest-environment` docblock at the top of each file. They test `fetch`
 *   and `Response` — both native to Node, both faster and more faithful there —
 *   and a DOM would only slow them down while changing nothing about what they
 *   assert.
 *
 * ## What these tests must never do
 *
 * They mock `fetch` at the boundary and make no network request, open no database
 * connection and start no server. They are therefore deterministic and safe to run
 * anywhere — including in CI with no services.
 */
export default defineConfig({
  // JSX must be transformed for component tests. This plugin is test-only and
  // does not affect the production build, which uses `vite.config.ts`.
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // Co-located with the source they cover: `request.test.ts` sits beside
    // `request.ts`, so the pair is obvious to anyone opening either file.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules/**', 'dist/**'],
    // Fail loudly rather than silently passing when a file has no tests.
    passWithNoTests: false,
  },
})