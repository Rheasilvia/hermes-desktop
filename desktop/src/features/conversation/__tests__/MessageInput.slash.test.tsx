import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ContextUsageProps } from '../ContextUsageBar.js';
import { MessageInput } from '../MessageInput.js';

const mocks = vi.hoisted(() => ({
  completeSlash: vi.fn(),
  completePath: vi.fn(),
  openDialog: vi.fn(),
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => ({
    complete: { slash: mocks.completeSlash, path: mocks.completePath },
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: mocks.openDialog,
}));

describe('MessageInput slash commands', () => {
  beforeEach(() => {
    mocks.completeSlash.mockReset();
    mocks.completeSlash.mockResolvedValue([
      { command: 'skin', description: 'Switch skin', category: 'Configuration' },
    ]);
    mocks.completePath.mockReset();
    mocks.completePath.mockResolvedValue([]);
    mocks.openDialog.mockReset();
  });

  test('requests slash completion with the current partial', async () => {
    render(() => <MessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });

    await waitFor(() => {
      expect(mocks.completeSlash).toHaveBeenCalledWith({ partial: '/sk' });
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

  test('selecting a slash command renders a command chip and submits serialized slash text', async () => {
    const onSend = vi.fn();
    render(() => <MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });

    await screen.findByText('/skin');
    fireEvent.click(screen.getByText('/skin'));

    expect(screen.getByText('/skin')).toBeDefined();
    expect(input.value).toBe('');

    fireEvent.input(input, { target: { value: 'mono' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith('/skin mono', undefined);
  });

  test('command chip is sized to align with the textarea text line', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/conversation/MessageInput.module.css'), 'utf8');
    const commandChipRule = css.match(/\.commandChip\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

    expect(commandChipRule).toContain('height: 22px');
    expect(commandChipRule).toContain('padding: 0 6px');
    expect(commandChipRule).toContain('line-height: 20px');
    expect(commandChipRule).not.toContain('padding: 5px 8px');
  });

  test('backspace at the start of empty args removes the slash chip and restores editable slash text', async () => {
    render(() => <MessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });

    await screen.findByText('/skin');
    fireEvent.click(screen.getByText('/skin'));
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(input.value).toBe('/skin');
  });

  test('keeps composer drafts isolated per session', async () => {
    let setSession!: (sessionId: string) => void;

    const Harness = () => {
      const [sessionId, updateSessionId] = createSignal('session-a');
      setSession = updateSessionId;
      return <MessageInput sessionId={sessionId()} cwd="/repo" onSend={vi.fn()} />;
    };

    render(() => <Harness />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });
    await screen.findByText('/skin');
    fireEvent.click(screen.getByText('/skin'));
    fireEvent.input(input, { target: { value: 'mono' } });

    setSession('session-b');

    await waitFor(() => {
      expect(input.value).toBe('');
    });

    fireEvent.input(input, { target: { value: 'second draft' } });
    setSession('session-a');

    await waitFor(() => {
      expect(input.value).toBe('mono');
      expect(screen.getByText('/skin')).toBeDefined();
    });

    setSession('session-b');

    await waitFor(() => {
      expect(input.value).toBe('second draft');
    });
  });

  test('shows @ reference starters and turns a concrete file completion into a ref attachment chip', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockResolvedValue(['src/main.ts']);
    render(() => <MessageInput cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@' } });

    await screen.findByText('@file:');
    fireEvent.click(screen.getByText('@file:'));
    expect(input.value).toBe('@file:');

    fireEvent.input(input, { target: { value: '@file:sr' } });
    await screen.findByText('@file:src/main.ts');
    fireEvent.click(screen.getByText('@file:src/main.ts'));

    expect(screen.getByText('main.ts')).toBeDefined();
    expect(input.value).toBe('');

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith('', [
      expect.objectContaining({ kind: 'file', refText: '@file:src/main.ts' }),
    ]);
  });

  test('manual @file text still submits unchanged', async () => {
    const onSend = vi.fn();
    render(() => <MessageInput onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@file:src/main.ts' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith('@file:src/main.ts', undefined);
  });

  test('drops workspace-bound draft attachments when the restored cwd differs', async () => {
    let setSession!: (sessionId: string) => void;
    let setCwd!: (cwd: string) => void;
    mocks.openDialog.mockResolvedValue(['/repo-a/src/main.ts']);

    const Harness = () => {
      const [sessionId, updateSessionId] = createSignal('session-cwd-a');
      const [cwd, updateCwd] = createSignal('/repo-a');
      setSession = updateSessionId;
      setCwd = updateCwd;
      return <MessageInput sessionId={sessionId()} cwd={cwd()} onSend={vi.fn()} />;
    };

    render(() => <Harness />);

    fireEvent.click(screen.getByLabelText('Add attachment'));
    fireEvent.click(screen.getByText('Add files'));

    await screen.findByText('main.ts');

    setSession('session-cwd-b');

    await waitFor(() => {
      expect(screen.queryByText('main.ts')).toBeNull();
    });

    setCwd('/repo-b');
    setSession('session-cwd-a');

    await waitFor(() => {
      expect(screen.queryByText('main.ts')).toBeNull();
    });
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
