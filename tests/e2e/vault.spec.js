/**
 * E2E: Vault Page — Entry Listing and Navigation
 *
 * Uses saved auth state (already logged in).
 * Note: Vault unlock requires entering the vault key via EncryptionKeyModal.
 * If vault is already unlocked (from session persistence), tests proceed directly.
 */
import { test, expect } from '@playwright/test';

test.describe('Vault Page', () => {
  test('navigates to vault page', async ({ page }) => {
    await page.goto('/vault');

    // Should either see the vault content or the encryption key modal
    const vaultContent = page.locator('.vault-page, .page-content, [class*="vault"]').first();
    const encryptionModal = page.locator('.modal, [class*="modal"]').first();

    // One of these should be visible
    await expect(
      vaultContent.or(encryptionModal)
    ).toBeVisible({ timeout: 10000 });
  });

  test('vault page has tab navigation', async ({ page }) => {
    await page.goto('/vault');

    // If encryption modal appears, vault is locked — skip tab check
    const modal = page.locator('.modal');
    const tabElements = page.locator('.tab, [role="tab"], button[class*="tab"]');

    // Wait for page to settle
    await expect(
      tabElements.first().or(modal)
    ).toBeVisible({ timeout: 10000 });

    // If vault is unlocked, tabs must be visible
    if (!(await modal.isVisible())) {
      await expect(tabElements.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test('vault page is accessible via sidebar navigation', async ({ page }) => {
    await page.goto('/');
    // Find vault link in sidebar
    const vaultLink = page.locator('a[href="/vault"], nav a:has-text("Vault")').first();
    await expect(vaultLink).toBeVisible({ timeout: 10000 });
    await vaultLink.click();
    await page.waitForURL('**/vault');
  });
});
