import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://localhost:5173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    // Auth setup — runs first, saves auth state for other tests
    {
      name: 'setup',
      testMatch: /auth\.setup\.js/,
      use: { browserName: 'chromium' },
    },
    {
      name: 'firefox',
      use: {
        browserName: 'chromium',
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  webServer: [
    {
      command: 'php -S localhost:8081 router.php',
      port: 8081,
      reuseExistingServer: true,
    },
    {
      command: 'npm run dev',
      port: 5173,
      reuseExistingServer: true,
    },
  ],
});
