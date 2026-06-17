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

async function renderSelector(gateway = makeGateway(), compact = false) {
  initializeStores(gateway);
  sessionStore.setSessionModel('session-1', 'openai', 'gpt-5');
  sessionStore.applyRuntime('session-1', { reasoningEffort: 'medium' });
  render(() => <ModelSelector sessionId="session-1" compact={compact} />);
  return gateway;
}

function blurActiveElement() {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur();
  }
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
    expect(screen.getByTestId('model-effort-trigger').textContent).toContain('High');
  });

  it('opens the full model picker from the model segment', async () => {
    await renderSelector();

    fireEvent.click(screen.getByRole('button', { name: 'Select model' }));

    expect(screen.getByText('Anthropic')).toBeDefined();
    expect(screen.getByText('Claude Sonnet')).toBeDefined();
  });

  it('renders the compact model trigger as icon-only while keeping the full accessible label', async () => {
    await renderSelector(makeGateway(), true);

    const trigger = screen.getByTestId('model-selector-trigger');

    expect(trigger.textContent).not.toContain('GPT-5');
    expect(trigger.getAttribute('aria-label')).toBe('Select model: GPT-5');
    expect(trigger.getAttribute('title')).toBe('GPT-5');

    fireEvent.click(trigger);
    expect(screen.getByText('Anthropic')).toBeDefined();
    expect(screen.getByText('Claude Sonnet')).toBeDefined();
  });

  it('keeps compact effort directly clickable with a short visible label', async () => {
    const gateway = await renderSelector(makeGateway(), true);
    const effort = screen.getByTestId('model-effort-trigger');

    expect(effort.textContent).toBe('Med');
    expect(effort.getAttribute('aria-label')).toContain('Reasoning effort: Med');

    fireEvent.click(effort);

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
    expect(screen.queryByText('Claude Sonnet')).toBeNull();
  });

  it('cycles effort directly from the effort segment without opening the model picker', async () => {
    const gateway = await renderSelector();

    fireEvent.click(screen.getByTestId('model-effort-trigger'));

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
    expect(screen.queryByText('Claude Sonnet')).toBeNull();
    expect(screen.queryByText('Left / Right to adjust reasoning')).toBeNull();
  });

  it('uses right arrow on the effort segment to increase effort without opening the model picker', async () => {
    const gateway = await renderSelector();

    fireEvent.keyDown(screen.getByTestId('model-effort-trigger'), { key: 'ArrowRight' });

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
    expect(screen.queryByText('Claude Sonnet')).toBeNull();
  });

  it('uses left arrow on the effort segment to decrease effort without opening the model picker', async () => {
    const gateway = await renderSelector();

    fireEvent.keyDown(screen.getByTestId('model-effort-trigger'), { key: 'ArrowLeft' });

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'low',
      });
    });
    expect(screen.queryByText('Claude Sonnet')).toBeNull();
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

  it('uses document arrow keys to cycle effort when focus leaves the dropdown', async () => {
    const gateway = await renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select model' });

    fireEvent.click(trigger);
    blurActiveElement();
    fireEvent.keyDown(document, { key: 'ArrowRight' });

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

  it('uses document up and down arrows plus enter to choose models when focus leaves the dropdown', async () => {
    const gateway = await renderSelector();
    const trigger = screen.getByRole('button', { name: 'Select model' });

    fireEvent.click(trigger);
    blurActiveElement();
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    fireEvent.keyDown(document, { key: 'Enter' });

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
