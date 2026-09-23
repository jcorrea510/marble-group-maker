import { defineConfig } from 'vitest/config';

// Long-running "stress test" that simulates many complete races headlessly.
// Run with: npm run simulate
export default defineConfig({
  test: {
    include: ['tests/sim/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30 * 60_000,
  },
});
