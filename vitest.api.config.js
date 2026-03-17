import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/api-js/**/*.test.js'],
    testTimeout: 15000,
    pool: 'forks',
  },
});
