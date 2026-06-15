import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeStores } from '@/stores/context.js';
import { sessionStore } from '@/stores/session.js';
import type { GatewayAdapter, SessionRuntime } from '@/services/gateway/types.js';
import { ModelSelector } from '../ModelSelector.js';

const modelMock = vi.hoisted(() => ({
  load: vi.fn(async () => undefined),
  providers: [
    {
      name: 'openai',
      display_name: 'OpenAI',
      models: [{ name: 'gpt-5', display_name: 'GPT-5' }],
    },
    {
      name: 'anthropic',
      display_name: 'Anthropic',
      models: [{ name: 'claude-sonnet', display_name: 'Claude Sonnet' }],
    },
  ],
}));

vi.mock('@/stores/models.js', () => ({
  modelsStore: {
    load: modelMock.load,
    providers: () => modelMock.providers,
  },
}));

function makeGateway(overrides: Partial<GatewayAdapter> = {}): GatewayAdapter {
  const updateRuntime = vi.fn(async (
    sessionId: string,
    patch: Partial<SessionRuntime>,
  ) => ({
    id: sessionId,
    runtime: { reasoningEffort: patch.reasoningEffort ?? 'medium' },
    appliedToActiveTurn: true,
    appliesNextTurn: false,
  }));
  const gateway = {
    session: {
      updateRuntime,
    },
    setSessionProvider: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as GatewayAdapter;
  return gateway;
}

async function renderSelector(gateway = makeGateway()) {
  initializeStores(gateway);
  sessionStore.setSessionModel('session-1', 'openai', 'gpt-5');
  sessionStore.applyRuntime('session-1', { reasoningEffort: 'medium' });
  render(() => <ModelSelector sessionId="session-1" />);
  return gateway;
}

describe('ModelSelector reasoning effort', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    initializeStores(null as unknown as GatewayAdapter);
  });

  it('shows the current session effort in the trigger and updates it from the rail', async () => {
    const gateway = await renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Select model' }));
    fireEvent.click(screen.getByRole('button', { name: 'High' }));

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
    expect(screen.getByRole('button', { name: 'Select model' }).textContent).toContain('High');
  });

  it('uses left and right arrows to cycle effort while the dropdown is open', async () => {
    const gateway = await renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select model' });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowRight' });

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
  });

  it('uses up and down arrows plus enter to choose models without changing effort', async () => {
    const gateway = await renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select model' });

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Enter' });

    await waitFor(() => {
      expect(gateway.setSessionProvider).toHaveBeenCalledWith(
        'session-1',
        'anthropic',
        'claude-sonnet',
      );
    });
    expect(gateway.session.updateRuntime).not.toHaveBeenCalled();
    expect(sessionStore.getSessionReasoningEffort('session-1')).toBe('medium');
  });
});
