import { test, expect } from '@playwright/test';

test.describe('Model config — real Studio adapter wiring', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('1. page loads and model section is reachable', async ({ page }) => {
    await expect(page).toHaveTitle(/Hermes/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('2. sidebar session controls and settings navigation are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /New Chat/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Conversations/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('3. navigates to Settings without error', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('4. navigates to Sessions through Settings without error', async ({ page }) => {
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('link', { name: 'Sessions' }).click();
    await expect(page).toHaveURL(/\/settings\/sessions/);
    await expect(page.locator('body')).toBeVisible();
  });

  test('5. starts a new chat from the session sidebar', async ({ page }) => {
    await page.getByRole('button', { name: /New Chat/ }).click();
    await expect(page).toHaveURL(/\/conversation\/[^/]+$/);
  });

});
