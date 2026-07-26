import { test, expect, type Locator, type Page } from '@playwright/test';

const PROVIDER_ROW_PREFIX = 'provider-row-';
const MODEL_ROW_PREFIX = 'model-row-';
const SEEDED_PROVIDER_IDS = ['e2e-alpha', 'e2e-beta'] as const;

async function gotoModelPage(page: Page) {
  await page.goto('/model');
  await page.getByTestId('main-model-card').waitFor({ state: 'visible' });
}

async function openModelPicker(page: Page): Promise<Locator> {
  await gotoModelPage(page);
  await page.getByTestId('main-model-change-btn').click();
  const modal = page.getByTestId('model-picker-modal');
  await expect(modal).toBeVisible();
  return modal;
}

async function rowId(row: Locator, prefix: string): Promise<string> {
  const testId = await row.getAttribute('data-testid');
  if (!testId?.startsWith(prefix)) {
    throw new Error(`Expected ${prefix} row, got ${testId ?? '<missing>'}`);
  }
  return testId.slice(prefix.length);
}

async function seededAlternateProviderId(modal: Locator): Promise<typeof SEEDED_PROVIDER_IDS[number]> {
  const subtitle = await modal.getByText(/current:/).textContent().catch(() => '');
  return subtitle?.includes('e2e-beta') ? 'e2e-alpha' : 'e2e-beta';
}

async function selectDifferentProviderModel(modal: Locator) {
  const providerId = await seededAlternateProviderId(modal);
  const provider = modal.getByTestId(`${PROVIDER_ROW_PREFIX}${providerId}`);
  await expect(provider).toBeVisible();
  await provider.click();

  const model = modal.locator('[data-testid^="model-row-"]').first();
  await expect(model).toBeVisible();
  const modelId = await rowId(model, MODEL_ROW_PREFIX);
  await model.click();

  return { providerId, modelId };
}

test.describe('Model page — MainModelCard', () => {
  test('card is visible and shows a model display or placeholder', async ({ page }) => {
    await gotoModelPage(page);
    await expect(page.getByText('Main Model')).toBeVisible();

    // The card always shows either a model name or the placeholder text
    const card = page.getByTestId('main-model-card');
    const hasDisplay = await card.getByTestId('main-model-display').isVisible().catch(() => false);
    const hasPlaceholder = await card.getByText('No model configured').isVisible().catch(() => false);
    expect(hasDisplay || hasPlaceholder).toBe(true);
  });

  test('card always shows a Configure or Change button', async ({ page }) => {
    await gotoModelPage(page);

    // The change/configure button is always present on the card (testid is stable)
    await expect(page.getByTestId('main-model-change-btn')).toBeVisible();
  });

  test('card bottom edge is above the Providers/Models tabs row', async ({ page }) => {
    await gotoModelPage(page);
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
  test('shows configured providers from the real sidecar response', async ({ page }) => {
    await gotoModelPage(page);
    // Provider cards are rendered by the ProviderCard component
    const providers = page.locator('[data-testid^="provider-row-"]');
    await expect(providers.first()).toBeVisible();
    expect(await providers.count()).toBeGreaterThanOrEqual(2);
  });
});

test.describe('Model page — ModelPickerModal', () => {
  test('opens on card button click and shows "Set Main Model" title', async ({ page }) => {
    await openModelPicker(page);
    await expect(page.getByText('Set Main Model')).toBeVisible();
  });

  test('shows current model subtitle when an active model is set', async ({ page }) => {
    await openModelPicker(page);
    // If there is a current model, the subtitle "current: <model>" is shown
    await expect(page.getByText(/current:/)).toBeVisible();
  });

  test('shows configured providers in the left column', async ({ page }) => {
    const modal = await openModelPicker(page);
    const providers = modal.locator('[data-testid^="provider-row-"]');
    await expect(providers.first()).toBeVisible();
    expect(await providers.count()).toBeGreaterThanOrEqual(2);
  });

  test('clicking a provider updates the model list', async ({ page }) => {
    const modal = await openModelPicker(page);
    const provider = modal.getByTestId(`${PROVIDER_ROW_PREFIX}${await seededAlternateProviderId(modal)}`);
    await expect(provider).toBeVisible();
    await provider.click();
    const model = modal.locator('[data-testid^="model-row-"]').first();
    await expect(model).toBeVisible();
    expect(await rowId(model, MODEL_ROW_PREFIX)).not.toHaveLength(0);
  });

  test('Switch button is disabled when no new selection has been made', async ({ page }) => {
    await openModelPicker(page);

    // Without selecting a different model, Switch is disabled (isDirty = false)
    await expect(page.getByTestId('model-picker-switch-btn')).toBeDisabled();
  });

  test('Switch button enables after selecting a different model', async ({ page }) => {
    const modal = await openModelPicker(page);
    await selectDifferentProviderModel(modal);
    await expect(page.getByTestId('model-picker-switch-btn')).toBeEnabled();
  });

  test('Switch applies the selection, updates the card, and closes the modal', async ({ page }) => {
    const modal = await openModelPicker(page);
    const selected = await selectDifferentProviderModel(modal);

    // switchModel is optimistic: updates signals immediately before any network call
    await page.getByTestId('model-picker-switch-btn').click();

    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
    // Card now shows the newly selected model
    await expect(page.getByTestId('main-model-display')).toContainText(selected.providerId);
    await expect(page.getByTestId('main-model-display')).toContainText(selected.modelId);
  });

  test('Cancel closes the modal without changing the active model', async ({ page }) => {
    await gotoModelPage(page);

    // Record the current card text before opening modal
    const display = page.getByTestId('main-model-display');
    const cardText = await display.isVisible().then((visible) => visible ? display.textContent() : '');

    await page.getByTestId('main-model-change-btn').click();
    const modal = page.getByTestId('model-picker-modal');
    await selectDifferentProviderModel(modal);
    await page.getByTestId('model-picker-cancel-btn').click();

    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
    // Card text is unchanged after cancel
    if (cardText) {
      await expect(page.getByTestId('main-model-display')).toHaveText(cardText);
    }
  });

  test('clicking the dim overlay closes the modal', async ({ page }) => {
    await gotoModelPage(page);
    await page.getByTestId('main-model-change-btn').click();
    await page.getByTestId('model-picker-modal').waitFor({ state: 'visible' });

    await page.getByTestId('model-picker-overlay').click({ position: { x: 10, y: 10 } });
    await expect(page.getByTestId('model-picker-modal')).not.toBeAttached();
  });
});
