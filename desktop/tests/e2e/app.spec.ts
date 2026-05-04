import { test, expect } from '@playwright/test';

test.describe('Hermes Desktop App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads without errors', async ({ page }) => {
    await expect(page).toHaveTitle(/Hermes/);
  });

  test('sidebar navigation items are visible', async ({ page }) => {
    await expect(page.getByText('Chat')).toBeVisible();
    await expect(page.getByText('Sessions')).toBeVisible();
    await expect(page.getByText('Settings')).toBeVisible();
  });

  test('navigating to Sessions changes URL', async ({ page }) => {
    await page.getByText('Sessions').click();
    await expect(page).toHaveURL(/\/sessions/);
  });
});
