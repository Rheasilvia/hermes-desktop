import { describe, expect, it, vi } from 'vitest';
import type { ReasoningEffort } from '@/types/index.js';
import { buildDefaultActions } from '../CommandPalette.js';

function makeCallbacks() {
  return {
    onNavigate: vi.fn(),
    onNewSession: vi.fn(),
    onToggleSidebar: vi.fn(),
    onCompressContext: vi.fn(),
    onClearHistory: vi.fn(),
    onSwitchModel: vi.fn(),
    onCycleReasoningEffort: vi.fn(),
    onSetReasoningEffort: vi.fn((effort: ReasoningEffort) => { void effort; }),
  };
}

describe('CommandPalette reasoning actions', () => {
  it('adds a command to cycle the active session reasoning effort', () => {
    const callbacks = makeCallbacks();
    const actions = buildDefaultActions(callbacks);

    actions.find(action => action.id === 'cycle-reasoning-effort')?.callback();

    expect(callbacks.onCycleReasoningEffort).toHaveBeenCalledOnce();
  });

  it('adds commands for each explicit reasoning effort level', () => {
    const callbacks = makeCallbacks();
    const actions = buildDefaultActions(callbacks);

    actions.find(action => action.id === 'set-reasoning-high')?.callback();
    actions.find(action => action.id === 'set-reasoning-none')?.callback();

    expect(callbacks.onSetReasoningEffort).toHaveBeenCalledWith('high');
    expect(callbacks.onSetReasoningEffort).toHaveBeenCalledWith('none');
  });
});
