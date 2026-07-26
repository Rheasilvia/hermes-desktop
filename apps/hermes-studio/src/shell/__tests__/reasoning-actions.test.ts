import { waitFor } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeStores } from '@/stores/context.js';
import { sessionStore } from '@/stores/session.js';
import type { GatewayAdapter, SessionRuntime } from '@/services/gateway/types.js';
import { cycleActiveReasoningEffort, updateActiveReasoningEffort } from '../reasoning-actions.js';

function makeGateway(): GatewayAdapter {
  const updateRuntime = vi.fn(async (
    sessionId: string,
    patch: Partial<SessionRuntime>,
  ) => ({
    id: sessionId,
    runtime: {
      reasoningEffort: patch.reasoningEffort ?? 'medium',
      collaborationMode: patch.collaborationMode ?? 'default',
    },
    appliedToActiveTurn: true,
    appliesNextTurn: false,
  }));
  return {
    session: { updateRuntime },
  } as unknown as GatewayAdapter;
}

describe('reasoning command palette actions', () => {
  beforeEach(() => {
    initializeStores(null as unknown as GatewayAdapter);
    sessionStore.setActiveSession(null);
  });

  it('updates the active session runtime directly', async () => {
    const gateway = makeGateway();
    initializeStores(gateway);
    sessionStore.setActiveSession('session-1');
    sessionStore.applyRuntime('session-1', { reasoningEffort: 'medium', collaborationMode: 'default' });

    updateActiveReasoningEffort('high');

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
  });

  it('cycles the active session runtime with the shared effort order', async () => {
    const gateway = makeGateway();
    initializeStores(gateway);
    sessionStore.setActiveSession('session-1');
    sessionStore.applyRuntime('session-1', { reasoningEffort: 'medium', collaborationMode: 'default' });

    cycleActiveReasoningEffort();

    await waitFor(() => {
      expect(gateway.session.updateRuntime).toHaveBeenCalledWith('session-1', {
        reasoningEffort: 'high',
      });
    });
  });
});
