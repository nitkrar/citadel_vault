/**
 * Playwright auth setup — runs once before all tests.
 * Logs in as initial_user and saves browser state (cookies, localStorage)
 * so subsequent tests start already authenticated.
 */
import { test as setup, expect } from '@playwright/test';

const AUTH_FILE = 'tests/e2e/.auth/user.json';

setup('authenticate as admin user', async ({ page }) => {
  // Navigate to login
  await page.goto('/login');
  await expect(page.locator('form')).toBeVisible();

  // Fill credentials
  await page.fill('input[autocomplete="username webauthn"]', 'initial_user');
  await page.fill('input[autocomplete="current-password"]', 'Initial#12$');

  // Submit
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard (authenticated area)
  await page.waitForURL('**/');
  // Verify we're logged in — the Layout sidebar should be present
  await expect(page.locator('nav, .sidebar, .layout-sidebar').first()).toBeVisible({ timeout: 10000 });

  // Save auth state
  await page.context().storageState({ path: AUTH_FILE });
});
