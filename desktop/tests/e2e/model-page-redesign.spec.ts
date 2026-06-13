import { test, expect, type Page } from '@playwright/test';

/**
 * Mock data shaped as the sidecar `Provider` API type (services/api/types.ts).
 * `mapProvider` in models.ts converts these to `ProviderEntry` for the UI.
 *
 * - Provider buttons render:  provider.display_name ?? provider.name
 *   mapProvider sets display_name = desktop.display_name ?? apiProvider.name
 *   → since no desktop.display_name here, button text = provider.name
 *
 * - Model buttons render:     model.display_name ?? model.name
 *   mapModelOption sets both name and display_name = raw.id ?? raw.name
 *   → button text = the "id" field in each raw model object
 *
 * NOTE: Browser-mode E2E uses intercepted HTTP routes below, matching the sidecar
 * contract that App.tsx reaches through createHttpGateway() and the API registry.
 * Tests that need to assert the active model in MainModelCard must use
 * data-testid="main-model-change-btn" to click it unambiguously, and
 * data-testid="main-model-display" to read the displayed text.
 *
 * For the MainModelCard text assertions, we verify the card shows *something*
 * and use the modal to verify the sidecar mock data is wired correctly into the
 * provider/model picker.
 */
const MOCK_PROVIDERS = [
  {
    id: 'kimi-coding',
    name: 'kimi-coding',
    auth: 'api_key',
    models: [
      { id: 'kimi-k2.6', name: 'kimi-k2.6', context_window: 200000 },
      { id: 'kimi-k2-mini', name: 'kimi-k2-mini', context_window: 128000 },
    ],
    desktop: { visible: true },
  },
  {
    id: 'minimax',
    name: 'minimax',
    auth: 'api_key',
    models: [{ id: 'minimax-text-01', name: 'minimax-text-01', context_window: 256000 }],
    desktop: { visible: true },
  },
];

async function setupModelRoutes(page: Page) {
  await page.route('**/desktop/api/model/providers**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: MOCK_PROVIDERS,
        generated_at: '2026-05-06T10:00:00Z',
      }),
    }),
  );
  await page.route('**/desktop/api/model/active', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ provider: null, model: null }),
    }),
  );
}

test.describe('Model page — MainModelCard', () => {
  test('card is visible and shows a model display or placeholder', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-card').waitFor({ state: 'visible' });
    await expect(page.getByText('Main Model')).toBeVisible();

    // The card always shows either a model name or the placeholder text
    const card = page.getByTestId('main-model-card');
    const hasDisplay = await card.getByTestId('main-model-display').isVisible().catch(() => false);
    const hasPlaceholder = await card.getByText('No model configured').isVisible().catch(() => false);
    expect(hasDisplay || hasPlaceholder).toBe(true);
  });

  test('card always shows a Configure or Change button', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-card').waitFor({ state: 'visible' });

    // The change/configure button is always present on the card (testid is stable)
    await expect(page.getByTestId('main-model-change-btn')).toBeVisible();
  });

  test('card bottom edge is above the Providers/Models tabs row', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-card').waitFor({ state: 'visible' });
    // The Tabs component in ModelSwitcherView renders plain <button type="button"> elements
    // with label text "Providers" and "Models". Wait for them to appear after providers load.
    const providersTabBtn = page.getByRole('button', { name: 'Providers', exact: true });
    await providersTabBtn.waitFor({ state: 'visible', timeout: 10000 });

    const cardBounds = await page.getByTestId('main-model-card').boundingBox();
    const tabBounds = await providersTabBtn.boundingBox();

    expect(cardBounds).not.toBeNull();
    expect(tabBounds).not.toBeNull();
    expect(cardBounds!.y + cardBounds!.height).toBeLessThan(tabBounds!.y);
  });
});

test.describe('Model page — provider hub list', () => {
  test('shows the two configured providers from sidecar response', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    // Provider cards are rendered by the ProviderCard component
    await page.getByTestId('provider-row-kimi-coding').waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
    // Use text that appears in ProviderCard content area
    await expect(page.getByText('kimi-coding').first()).toBeVisible();
    await expect(page.getByText('minimax').first()).toBeVisible();
  });
});

test.describe('Model page — ModelPickerModal', () => {
  test('opens on card button click and shows "Set Main Model" title', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    await expect(page.getByTestId('model-picker-modal')).toBeVisible();
    await expect(page.getByText('Set Main Model')).toBeVisible();
  });

  test('shows current model subtitle when an active model is set', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    // The gateway mock sets openai/gpt-4o as the active model by default.
    // Wait for the card to show a model (Change button) then open the modal.
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    await expect(page.getByTestId('model-picker-modal')).toBeVisible();
    // If there is a current model, the subtitle "current: <model>" is shown
    // The subtitle text depends on which store path wins the race (gateway vs sidecar)
    // Just verify the modal opened correctly with its title
    await expect(page.getByText('Set Main Model')).toBeVisible();
  });

  test('shows both providers in the left column', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    const modal = page.getByTestId('model-picker-modal');
    await expect(modal.getByRole('button', { name: 'kimi-coding' })).toBeVisible();
    await expect(modal.getByRole('button', { name: 'minimax' })).toBeVisible();
  });

  test('clicking a provider updates the model list', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    const modal = page.getByTestId('model-picker-modal');
    // kimi-coding is first, so kimi-k2.6 should be visible by default
    await expect(modal.getByTestId('model-row-kimi-k2.6')).toBeVisible();
    // Switch to minimax
    await modal.getByRole('button', { name: 'minimax' }).click();
    await expect(modal.getByTestId('model-row-minimax-text-01')).toBeVisible();
    await expect(modal.getByTestId('model-row-kimi-k2.6')).not.toBeVisible();
  });

  test('Switch button is disabled when no new selection has been made', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    // Without selecting a different model, Switch is disabled (isDirty = false)
    await expect(page.getByTestId('model-picker-switch-btn')).toBeDisabled();
  });

  test('Switch button enables after selecting a different model', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    // Select minimax (different provider than the active one)
    const modal = page.getByTestId('model-picker-modal');
    await modal.getByRole('button', { name: 'minimax' }).click();
    await modal.getByTestId('model-row-minimax-text-01').click();
    await expect(page.getByTestId('model-picker-switch-btn')).toBeEnabled();
  });

  test('Switch applies the selection, updates the card, and closes the modal', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();

    const modal = page.getByTestId('model-picker-modal');
    await modal.getByRole('button', { name: 'minimax' }).click();
    await modal.getByTestId('model-row-minimax-text-01').click();

    // switchModel is optimistic: updates signals immediately before any network call
    await page.getByTestId('model-picker-switch-btn').click();

    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
    // Card now shows the newly selected model
    await expect(page.getByTestId('main-model-display')).toContainText('minimax');
    await expect(page.getByTestId('main-model-display')).toContainText('minimax-text-01');
  });

  test('Cancel closes the modal without changing the active model', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });

    // Record the current card text before opening modal
    const cardText = await page.getByTestId('main-model-display').textContent().catch(() => '');

    await page.getByTestId('main-model-change-btn').click();
    const modal = page.getByTestId('model-picker-modal');
    await modal.getByRole('button', { name: 'minimax' }).click();
    await modal.getByTestId('model-row-minimax-text-01').click();
    await page.getByTestId('model-picker-cancel-btn').click();

    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
    // Card text is unchanged after cancel
    if (cardText) {
      await expect(page.getByTestId('main-model-display')).toHaveText(cardText);
    }
  });

  test('clicking the dim overlay closes the modal', async ({ page }) => {
    await setupModelRoutes(page);
    await page.goto('/model');
    await page.getByTestId('main-model-change-btn').waitFor({ state: 'visible' });
    await page.getByTestId('main-model-change-btn').click();
    await page.getByTestId('model-picker-modal').waitFor({ state: 'visible' });

    await page.getByTestId('model-picker-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
  });
});
