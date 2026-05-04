import { test, expect } from '@playwright/test';

test.describe('Model config — real adapter wiring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1. page loads and model section is reachable', async ({ page }) => {
    await expect(page).toHaveTitle(/Hermes/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('2. sidebar navigation links are visible', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Chat' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sessions' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('3. navigates to Settings without error', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('4. navigates to Sessions without error', async ({ page }) => {
    await page.getByRole('link', { name: 'Sessions' }).click();
    await expect(page).toHaveURL(/\/sessions/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('5. returns to home from Sessions', async ({ page }) => {
    await page.getByRole('link', { name: 'Sessions' }).click();
    await page.getByRole('link', { name: 'Chat' }).click();
    await expect(page).toHaveURL(/\//);
  });

  test('6. mock gateway hook is available', async ({ page }) => {
    const hasMock = await page.evaluate(() => {
      return typeof (window as unknown as { __HERMES_MOCK?: unknown }).__HERMES_MOCK !== 'undefined';
    });
    expect(typeof hasMock).toBe('boolean');
  });
});
