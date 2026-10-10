import { defineConfig } from 'vitest/config';

/** Firestore security-rules tests. Require the Firestore emulator. */
export default defineConfig({
  test: {
    include: ['firebase/**/*.test.ts'],
    exclude: ['**/node_modules/**'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
