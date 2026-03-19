/**
 * E2E: Portfolio Page — Tab Rendering and Navigation
 *
 * Uses saved auth state. Portfolio page renders 7 tabs:
 * Overview, By Country, By Account, By Asset Type, All Assets, By Currency, History
 */
import { test, expect } from '@playwright/test';

test.describe('Portfolio Page', () => {
  test('navigates to portfolio page', async ({ page }) => {
    await page.goto('/portfolio');

    // Should see portfolio page content or encryption modal
    const pageContent = page.locator('.page-content, [class*="portfolio"], h1, h2').first();
    const encryptionModal = page.locator('.modal').first();

    await expect(
      pageContent.or(encryptionModal)
    ).toBeVisible({ timeout: 10000 });
  });

  test('portfolio page is accessible via sidebar', async ({ page }) => {
    await page.goto('/');
    const portfolioLink = page.locator('a[href="/portfolio"], nav a:has-text("Portfolio")').first();
    await expect(portfolioLink).toBeVisible({ timeout: 10000 });
    await portfolioLink.click();
    await page.waitForURL('**/portfolio');
  });

  test('portfolio page shows tabs when vault is unlocked', async ({ page }) => {
    await page.goto('/portfolio');

    const modal = page.locator('.modal');
    const pageContent = page.locator('.page-content, [class*="portfolio"]').first();

    // Wait for page to settle
    await expect(
      pageContent.or(modal)
    ).toBeVisible({ timeout: 10000 });

    // If vault is unlocked, at least one portfolio tab must be visible
    if (!(await modal.isVisible())) {
      const tabTexts = ['Overview', 'By Country', 'By Account', 'By Asset Type', 'All Assets', 'By Currency', 'History'];
      const anyTab = page.locator(tabTexts.map(t => `text="${t}"`).join(', ')).first();
      await expect(anyTab).toBeVisible({ timeout: 5000 });
    }
  });
});
