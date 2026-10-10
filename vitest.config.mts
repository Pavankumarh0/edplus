import { defineConfig } from 'vitest/config';

/**
 * Unit tests — pure, fast, no emulator.
 * Firestore rules tests live in vitest.rules.config.ts because they need a
 * running emulator and would otherwise fail a plain `npm test`.
 */
export default defineConfig({
  test: {
    include: ['packages/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/*.integration.test.ts'],
  },
});
