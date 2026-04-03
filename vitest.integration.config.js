import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.js'],
    testTimeout: 30000,
    pool: 'forks',
    globalSetup: './tests/helpers/testServer.js',
  },
});
