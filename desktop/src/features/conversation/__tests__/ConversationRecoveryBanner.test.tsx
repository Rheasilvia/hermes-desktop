import { render, screen } from '@solidjs/testing-library';
import { describe, expect, test } from 'vitest';

import { ConversationRecoveryBanner } from '../ConversationRecoveryBanner.js';

describe('ConversationRecoveryBanner', () => {
  test('shows backend accepted with no stream as a waiting state', () => {
    render(() => (
      <ConversationRecoveryBanner
        turnState="accepted"
        connectionState="connected"
        diagnostics={{ lastEventAt: Date.now(), droppedLateEvents: 0 }}
      />
    ));

    expect(screen.getByText('Backend accepted the turn. Waiting for stream...')).toBeDefined();
  });

  test('shows stalled turn recovery guidance', () => {
    render(() => (
      <ConversationRecoveryBanner
        turnState="stalled"
        connectionState="connected"
        diagnostics={{ lastEventAt: Date.now() - 90_000, droppedLateEvents: 2 }}
      />
    ));

    expect(screen.getByText('No stream events for a while. You can wait or stop this turn.')).toBeDefined();
    expect(screen.getByText('2 late events dropped')).toBeDefined();
  });

  test('shows awaiting user input as a waiting state', () => {
    render(() => (
      <ConversationRecoveryBanner
        turnState="awaiting_user"
        connectionState="connected"
        diagnostics={{ lastEventAt: Date.now(), droppedLateEvents: 0 }}
      />
    ));

    expect(screen.getByText('Waiting for your input...')).toBeDefined();
  });

  test('shows reconnecting state even when the current turn is streaming', () => {
    render(() => (
      <ConversationRecoveryBanner
        turnState="streaming"
        connectionState="reconnecting"
        diagnostics={{ lastEventAt: Date.now(), droppedLateEvents: 0 }}
      />
    ));

    expect(screen.getByText('Reconnecting to the sidecar stream...')).toBeDefined();
  });

  test('renders nothing for a healthy idle turn', () => {
    const { container } = render(() => (
      <ConversationRecoveryBanner
        turnState="idle"
        connectionState="connected"
        diagnostics={{ lastEventAt: null, droppedLateEvents: 0 }}
      />
    ));

    expect(container.textContent).toBe('');
  });
});
