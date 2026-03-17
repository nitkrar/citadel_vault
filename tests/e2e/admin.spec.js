/**
 * E2E: Admin Pages — Users, Reference Data, Settings
 *
 * Uses saved auth state (admin user).
 * Verifies admin pages load and render key content.
 */
import { test, expect } from '@playwright/test';

test.describe('Admin Pages', () => {
  test('admin/users page loads and shows user list', async ({ page }) => {
    await page.goto('/admin/users');

    // Should see the users page with at least the admin user
    await expect(page.locator('text=initial_user')).toBeVisible({ timeout: 10000 });
  });

  test('admin/reference page loads', async ({ page }) => {
    await page.goto('/admin/reference');

    // Should see reference data tabs or content
    const pageContent = page.locator('.page-content, h1, h2, table').first();
    await expect(pageContent).toBeVisible({ timeout: 10000 });
  });

  test('admin/settings page loads and shows settings', async ({ page }) => {
    await page.goto('/admin/settings');

    // Settings page is data-driven — should show at least one setting
    const settingElements = page.locator('input, select, .setting, .form-group, label').first();
    await expect(settingElements).toBeVisible({ timeout: 10000 });
  });

  test('admin pages are accessible via sidebar', async ({ page }) => {
    await page.goto('/');

    // Admin section should have Users, Reference Data, Settings links
    const usersLink = page.locator('a[href="/admin/users"]').first();
    await expect(usersLink).toBeVisible({ timeout: 10000 });

    const refLink = page.locator('a[href="/admin/reference"]').first();
    await expect(refLink).toBeVisible();

    const settingsLink = page.locator('a[href="/admin/settings"]').first();
    await expect(settingsLink).toBeVisible();
  });

  test('/admin redirects to /admin/users', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL('**/admin/users');
  });

  test('/settings redirects to /admin/settings', async ({ page }) => {
    await page.goto('/settings');
    await page.waitForURL('**/admin/settings');
  });
});
