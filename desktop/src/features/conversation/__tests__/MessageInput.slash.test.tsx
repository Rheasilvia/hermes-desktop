import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { describe, test, expect, vi, beforeEach } from 'vitest';
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

  test('submits slash text through onSend instead of swallowing Enter', async () => {
    const onSend = vi.fn();
    render(() => <MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/help now' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });

    expect(onSend).toHaveBeenCalledWith('/help now', undefined);
  });
});

