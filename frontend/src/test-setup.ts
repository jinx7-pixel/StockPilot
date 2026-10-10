/**
 * Global test setup.
 *
 * Loaded by Vitest before every test file (see `vitest.config.ts`).
 *
 * Registers the Testing Library matchers — `toHaveFocus`, `toBeInTheDocument`,
 * `toHaveAccessibleName` and friends. These are what let the component tests
 * assert on *accessible* behaviour rather than on implementation detail: they ask
 * "is this labelled?" and "does it have focus?", not "does this div have class X".
 */

import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Testing Library mounts into `document.body`; unmounting between tests stops
// one test's DOM from leaking into the next.
afterEach(() => {
  cleanup()
})