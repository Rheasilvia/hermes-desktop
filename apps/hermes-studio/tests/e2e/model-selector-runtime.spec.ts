import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

const SIDECAR_PORT = process.env.DESKTOP_E2E_SIDECAR_PORT ?? '18180';
const SIDECAR_TOKEN = process.env.DESKTOP_E2E_SIDECAR_TOKEN ?? 'playwright-secret';
const SIDECAR_BASE_URL = `http://127.0.0.1:${SIDECAR_PORT}`;

type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

async function sidecarRequest<T>(
  request: APIRequestContext,
  method: 'GET' | 'PATCH' | 'POST',
  path: string,
  data?: unknown,
): Promise<T> {
  const response = await request.fetch(`${SIDECAR_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${SIDECAR_TOKEN}`,
      'Content-Type': 'application/json',
    },
    data,
  });
  if (!response.ok()) {
    throw new Error(`${method} ${path} failed: ${response.status()} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function createSession(
  request: APIRequestContext,
  provider: string,
  model: string,
): Promise<string> {
  const body = await sidecarRequest<{ id?: string; session_id?: string }>(
    request,
    'POST',
    '/desktop/api/sessions',
    { provider, model },
  );
  const id = body.id ?? body.session_id;
  expect(id).toBeTruthy();
  return id!;
}

async function expectPersistedRuntime(
  request: APIRequestContext,
  sessionId: string,
  effort: ReasoningEffort,
): Promise<void> {
  const body = await sidecarRequest<{ runtime?: { reasoningEffort?: string } }>(
    request,
    'GET',
    `/desktop/api/sessions/${sessionId}`,
  );
  expect(body.runtime?.reasoningEffort).toBe(effort);
}

async function setEffortInPicker(
  page: Page,
  sessionId: string,
  effort: ReasoningEffort,
  label: string,
): Promise<void> {
  await page.goto(`/conversation/${sessionId}`);
  await expect(page).toHaveURL(new RegExp(`/conversation/${sessionId}$`));
  const trigger = page.getByTestId('model-selector-trigger');
  await expect(trigger).toBeVisible();
  await trigger.click();
  await page.getByTestId(`model-effort-${effort}`).click();
  await expect(trigger).toContainText(label);
}

test.describe('Chat model picker runtime', () => {
  test('keeps reasoning effort isolated per session and persisted after refresh', async ({ page, request }) => {
    const highSession = await createSession(request, 'e2e-alpha', 'e2e-alpha-primary');
    const offSession = await createSession(request, 'e2e-beta', 'e2e-beta-primary');

    await setEffortInPicker(page, highSession, 'high', 'High');
    await expectPersistedRuntime(request, highSession, 'high');

    await setEffortInPicker(page, offSession, 'none', 'Off');
    await expectPersistedRuntime(request, offSession, 'none');

    await page.goto(`/conversation/${highSession}`);
    await expect(page.getByTestId('model-selector-trigger')).toContainText('High');
    await page.reload();
    await expect(page.getByTestId('model-selector-trigger')).toContainText('High');

    await page.goto(`/conversation/${offSession}`);
    await expect(page.getByTestId('model-selector-trigger')).toContainText('Off');
    await page.reload();
    await expect(page.getByTestId('model-selector-trigger')).toContainText('Off');
  });
});
