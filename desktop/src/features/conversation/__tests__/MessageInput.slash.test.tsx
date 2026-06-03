import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ContextUsageProps } from '../ContextUsageBar.js';
import { MessageInput } from '../MessageInput.js';

const completeSlash = vi.fn();

vi.mock('@/stores/context.js', () => ({
  getGateway: () => ({
    complete: { slash: completeSlash },
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}));

describe('MessageInput slash commands', () => {
  beforeEach(() => {
    completeSlash.mockReset();
    completeSlash.mockResolvedValue([
      { command: 'model', description: 'Switch model', category: 'Configuration' },
    ]);
  });

  test('requests slash completion with the current partial', async () => {
    render(() => <MessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/mo' } });

    await waitFor(() => {
      expect(completeSlash).toHaveBeenCalledWith({ partial: '/mo' });
    });
  });

  test('submits slash text through onSend on Cmd/Ctrl+Enter', async () => {
    const onSend = vi.fn();
    render(() => <MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/help now' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith('/help now', undefined);
  });

  test('plain Enter does not send (newline only — avoids accidental submit)', async () => {
    const onSend = vi.fn();
    render(() => <MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/help now' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).not.toHaveBeenCalled();
  });

  test('updates token usage when context usage changes after render', async () => {
    let setUsage!: (usage: ContextUsageProps) => void;

    const Harness = () => {
      const [usage, updateUsage] = createSignal<ContextUsageProps>({
        contextUsed: null,
        contextMax: null,
        contextPercent: null,
        costUsd: null,
        totalTokens: null,
      });
      setUsage = updateUsage;
      return <MessageInput onSend={vi.fn()} contextUsage={usage()} />;
    };

    render(() => <Harness />);
    expect(screen.getByText('0 tokens')).toBeDefined();

    setUsage({
      contextUsed: null,
      contextMax: null,
      contextPercent: null,
      costUsd: null,
      totalTokens: 1234,
    });

    await waitFor(() => {
      expect(screen.getByText('1.2k tokens')).toBeDefined();
    });
  });
});
