import { defineConfig } from 'vitest/config';

/**
 * Emulator-backed tests: Firestore security rules, plus tool-layer integration
 * tests that assert what actually lands in Firestore (audit rows, refusals,
 * the approval boundary). Kept out of `npm test` because they need the
 * emulator running.
 */
export default defineConfig({
  test: {
    include: ['firebase/**/*.test.ts', 'packages/**/*.integration.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
