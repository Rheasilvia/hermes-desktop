import { test, expect } from '@playwright/test';

test.describe('Hermes Desktop App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads without errors', async ({ page }) => {
    await expect(page).toHaveTitle(/Hermes/);
  });

  test('sidebar navigation items are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /New Chat/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('navigating to Sessions changes URL', async ({ page }) => {
    await page.getByRole('link', { name: 'Sessions' }).click();
    await expect(page).toHaveURL(/\/sessions/);
  });
});
