import { test, expect } from '@playwright/test';

test.describe('Hermes Studio App', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('page loads without errors', async ({ page }) => {
    await expect(page).toHaveTitle(/Hermes/);
  });

  test('sidebar session controls and settings navigation are visible', async ({ page }) => {
    await expect(page.getByRole('button', { name: /New Chat/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Conversations/ })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  });

  test('starting a new chat opens a new conversation route', async ({ page }) => {
    const previousUrl = page.url();
    await page.getByRole('button', { name: /New Chat/ }).click();
    await expect(page).toHaveURL(/\/conversation\/[^/]+$/);
    await expect.poll(() => page.url()).not.toBe(previousUrl);
  });
});
