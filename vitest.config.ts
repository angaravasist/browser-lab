import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/api/tests/**/*.test.ts'],
    testTimeout: 30_000,
    pool: 'forks',
  },
});
