/**
 * E2E: Login & Authentication Flows
 *
 * Tests the login page, error handling, and logout.
 * These tests do NOT use the saved auth state — they test auth from scratch.
 */
import { test, expect } from '@playwright/test';

// Override: don't use saved auth state for login tests
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders login form with username and password fields', async ({ page }) => {
    await expect(page.locator('input[autocomplete="username webauthn"]')).toBeVisible();
    await expect(page.locator('input[autocomplete="current-password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toContainText('Sign In');
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.fill('input[autocomplete="username webauthn"]', 'wrong_user');
    await page.fill('input[autocomplete="current-password"]', 'WrongPass123!');
    await page.click('button[type="submit"]');

    // Should show error alert
    await expect(page.locator('.alert-danger, .alert.alert-danger')).toBeVisible({ timeout: 5000 });
  });

  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.fill('input[autocomplete="username webauthn"]', 'initial_user');
    await page.fill('input[autocomplete="current-password"]', 'Initial#12$');
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL('/');
    // Should see authenticated content (sidebar nav)
    await expect(page.locator('nav, .sidebar, .layout-sidebar').first()).toBeVisible({ timeout: 10000 });
  });

  test('has forgot password link', async ({ page }) => {
    const link = page.locator('a[href="/forgot-password"]');
    await expect(link).toBeVisible();
    await expect(link).toContainText('Forgot password');
  });
});

test.describe('Logout', () => {
  test('can log in and then log out', async ({ page }) => {
    // Login first
    await page.goto('/login');
    await page.fill('input[autocomplete="username webauthn"]', 'initial_user');
    await page.fill('input[autocomplete="current-password"]', 'Initial#12$');
    await page.click('button[type="submit"]');
    await page.waitForURL('/');

    // Find and click logout button in sidebar footer
    await page.locator('button:has-text("Sign Out")').click();

    // Should redirect to login or home
    await page.waitForURL(/\/(login|home)/);
  });
});
