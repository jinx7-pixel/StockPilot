/**
 * ESLint flat config for the StockPilot migrations project.
 *
 * Migrations live outside the `backend` package, so ESLint (which only matches
 * files inside its config's base path) needs a config rooted here. The
 * TypeScript tooling itself is not duplicated: it is borrowed from the single
 * `backend/node_modules` install via `createRequire`, so this directory stays
 * dependency-free.
 *
 * Linted with:
 *   cd backend && npm run lint
 */

import { createRequire } from 'node:module';

import globals from '../backend/node_modules/globals/index.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

export default tseslint.config(
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['migrations/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      eqeqeq: ['error', 'smart'],
    },
  },
);
