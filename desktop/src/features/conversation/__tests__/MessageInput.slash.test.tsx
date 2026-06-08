import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render, screen, fireEvent, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { ContextUsageProps } from '../ContextUsageBar.js';
import { MessageInput } from '../MessageInput.js';
import { clearAllComposerDrafts } from '@/stores/composer-drafts.js';

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
    clearAllComposerDrafts();
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
    const textareaRowRule = css.match(/\.textareaRow\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
    const textareaRule = css.match(/\.textarea\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
    const inlineFileChipRule = css.match(/\.inlineFileChip\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';
    const commandChipRule = css.match(/\.commandChip\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

    expect(textareaRowRule).toContain('align-items: center');
    expect(textareaRule).toContain('min-height: 22px');
    expect(textareaRule).toContain('line-height: 22px');
    expect(inlineFileChipRule).toContain('height: 22px');
    expect(inlineFileChipRule).toContain('line-height: 22px');
    expect(commandChipRule).toContain('height: 22px');
    expect(commandChipRule).toContain('padding: 0 6px');
    expect(commandChipRule).toContain('line-height: 22px');
    expect(commandChipRule).not.toContain('padding: 5px 8px');
  });

  test('textarea starts on a full-width row when inline chips are present', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/features/conversation/MessageInput.module.css'), 'utf8');
    const inlineChipRowRule = css.match(/\.textareaRowWithInlineChips\s+\.textarea\s*\{(?<body>[^}]+)\}/)?.groups?.body ?? '';

    expect(inlineChipRowRule).toContain('flex-basis: 100%');
    expect(inlineChipRowRule).toContain('width: 100%');
  });

  test('backspace at the start of empty args removes the slash chip', async () => {
    render(() => <MessageInput onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });

    await screen.findByText('/skin');
    fireEvent.click(screen.getByText('/skin'));
    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(input.value).toBe('');
    expect(screen.queryByText('/skin')).toBeNull();
  });

  test('empty ArrowUp and ArrowDown browse previous user messages', async () => {
    render(() => (
      <MessageInput
        onSend={vi.fn()}
        historyMessages={[
          {
            id: 1,
            sessionId: 'session-history',
            role: 'user',
            blocks: [{ type: 'text', id: 'b1', content: 'first prompt' }],
            timestamp: 1,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
          },
          {
            id: 2,
            sessionId: 'session-history',
            role: 'assistant',
            blocks: [{ type: 'text', id: 'b2', content: 'reply' }],
            timestamp: 2,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
          },
          {
            id: 3,
            sessionId: 'session-history',
            role: 'user',
            blocks: [{ type: 'text', id: 'b3', content: 'second prompt' }],
            timestamp: 3,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
          },
        ]}
      />
    ));

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('second prompt');

    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(input.value).toBe('first prompt');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('second prompt');

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.value).toBe('');
  });

  test('ArrowUp restores slash command history as a command chip', async () => {
    render(() => (
      <MessageInput
        onSend={vi.fn()}
        historyMessages={[
          {
            id: 0,
            sessionId: 'session-history-chip',
            role: 'user',
            blocks: [{ type: 'text', id: 'b0', content: 'older prompt' }],
            timestamp: 0,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
          },
          {
            id: 1,
            sessionId: 'session-history-chip',
            role: 'user',
            blocks: [{ type: 'text', id: 'b1', content: '/arxiv transformers' }],
            timestamp: 1,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
            submitText: 'Expanded skill prompt that should not be restored',
            slashCommand: { command: 'arxiv', args: 'transformers' },
          },
        ]}
      />
    ));

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(screen.getByText('/arxiv')).toBeDefined();
    expect(input.value).toBe('transformers');

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(screen.queryByText('/arxiv')).toBeNull();
    expect(input.value).toBe('older prompt');
  });

  test('ArrowUp restores inline file history as a file chip', async () => {
    render(() => (
      <MessageInput
        onSend={vi.fn()}
        historyMessages={[
          {
            id: 1,
            sessionId: 'session-history-file-chip',
            role: 'user',
            blocks: [{ type: 'text', id: 'b1', content: '[File 1: README.md] summarize this' }],
            timestamp: 1,
            tokenCount: null,
            finishReason: null,
            isStreaming: false,
            actions: [],
            toolName: null,
            displayParts: [
              {
                type: 'file_ref',
                refText: '@file:README.md',
                name: 'README.md',
                detail: 'README.md',
                anchor: 'File 1',
              },
              { type: 'text', text: ' summarize this' },
            ],
          },
        ]}
      />
    ));

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;

    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(screen.getByTestId('inline-file-chip')).toBeDefined();
    expect(screen.getByText('README.md')).toBeDefined();
    expect(input.value).toBe(' summarize this');
  });

  test('backspace at the start of empty text removes the previous inline file chip', async () => {
    mocks.completePath.mockResolvedValue([
      { text: '@file:docs/mydoc.txt', display: 'mydoc.txt', meta: 'docs' },
    ]);
    render(() => <MessageInput sessionId="session-backspace-file" cwd="/repo" onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@my' } });

    await screen.findByText('mydoc.txt');
    fireEvent.click(screen.getByText('mydoc.txt'));
    expect(screen.getByTestId('inline-file-chip')).toBeDefined();

    input.setSelectionRange(0, 0);
    fireEvent.keyDown(input, { key: 'Backspace' });

    expect(screen.queryByTestId('inline-file-chip')).toBeNull();
    expect(input.value).toBe('');
  });

  test('keeps composer drafts isolated per session', async () => {
    let setSession!: (sessionId: string) => void;

    const Harness = () => {
      const [sessionId, updateSessionId] = createSignal('session-draft-a');
      setSession = updateSessionId;
      return <MessageInput sessionId={sessionId()} cwd="/repo" onSend={vi.fn()} />;
    };

    render(() => <Harness />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '/sk' } });
    await screen.findByText('/skin');
    fireEvent.click(screen.getByText('/skin'));
    fireEvent.input(input, { target: { value: 'mono' } });

    setSession('session-draft-b');

    await waitFor(() => {
      expect(input.value).toBe('');
    });

    fireEvent.input(input, { target: { value: 'second draft' } });
    setSession('session-draft-a');

    await waitFor(() => {
      expect(input.value).toBe('mono');
      expect(screen.getByText('/skin')).toBeDefined();
    });

    setSession('session-draft-b');

    await waitFor(() => {
      expect(input.value).toBe('second draft');
    });
  });

  test('requests @ path completions with the active session and cwd', async () => {
    mocks.completePath.mockResolvedValue([]);
    render(() => <MessageInput sessionId="session-at" cwd="/repo" onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@file:sr' } });

    await waitFor(() => {
      expect(mocks.completePath).toHaveBeenCalledWith({
        partial: '@file:sr',
        sessionId: 'session-at',
        cwd: '/repo',
      });
    });
  });

  test('bare @ query shows fuzzy file candidates and selected chip relative path', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockResolvedValue([
      { text: '@file:docs/mydoc.txt', display: 'mydoc.txt', meta: 'docs' },
    ]);
    render(() => <MessageInput sessionId="session-bare-at" cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@my' } });

    await waitFor(() => {
      expect(mocks.completePath).toHaveBeenCalledWith({
        partial: '@my',
        sessionId: 'session-bare-at',
        cwd: '/repo',
      });
    });
    await screen.findByText('mydoc.txt');
    expect(screen.getByText('docs')).toBeDefined();

    fireEvent.click(screen.getByText('mydoc.txt'));

    expect(input.value).toBe('');
    expect(screen.getByText('mydoc.txt')).toBeDefined();
    expect(screen.getByTestId('inline-file-chip')).toBeDefined();
    expect(screen.queryByTestId('attachment-chip-bar')).toBeNull();

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith(
      '[File 1: mydoc.txt]',
      [
        expect.objectContaining({
          kind: 'file',
          name: 'mydoc.txt',
          detail: 'docs/mydoc.txt',
          refText: '@file:docs/mydoc.txt',
        }),
      ],
      [
        expect.objectContaining({
          type: 'file_ref',
          anchor: 'File 1',
          name: 'mydoc.txt',
          detail: 'docs/mydoc.txt',
          refText: '@file:docs/mydoc.txt',
        }),
      ],
    );
  });

  test('inline file refs submit anchored LLM text, newline context refs, and ordered display parts', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockImplementation(({ partial }: { partial: string }) => {
      if (partial === '@one') {
        return Promise.resolve([
          { text: '@file:docs/one.ts:1-3', display: 'one.ts', meta: 'docs' },
        ]);
      }
      if (partial === '@two') {
        return Promise.resolve([
          { text: '@file:src/two.ts', display: 'two.ts', meta: 'src' },
        ]);
      }
      return Promise.resolve([]);
    });
    render(() => <MessageInput sessionId="session-inline-files" cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLElement;
    fireEvent.input(input, { target: { value: '@one 这个文件是做什么的？' } });
    await screen.findByText('one.ts');
    fireEvent.click(screen.getByText('one.ts'));

    fireEvent.input(input, { target: { value: '@two 跟这个文件有联系吗？' } });
    await screen.findByText('two.ts');
    fireEvent.click(screen.getByText('two.ts'));

    expect(screen.getByText('one.ts:L1-L3')).toBeDefined();
    expect(screen.getByText('two.ts')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith(
      '[File 1: one.ts:L1-L3] 这个文件是做什么的？ [File 2: two.ts] 跟这个文件有联系吗？',
      [
        expect.objectContaining({ name: 'one.ts', refText: '@file:docs/one.ts:1-3' }),
        expect.objectContaining({ name: 'two.ts', refText: '@file:src/two.ts' }),
      ],
      [
        expect.objectContaining({ type: 'file_ref', anchor: 'File 1', name: 'one.ts', lineStart: 1, lineEnd: 3 }),
        expect.objectContaining({ type: 'text', text: ' 这个文件是做什么的？ ' }),
        expect.objectContaining({ type: 'file_ref', anchor: 'File 2', name: 'two.ts' }),
        expect.objectContaining({ type: 'text', text: ' 跟这个文件有联系吗？' }),
      ],
    );
  });

  test('inline file ref chips preserve quoted paths and line ranges', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockResolvedValue([
      { text: '@file:"docs/my file.ts":7-9', display: 'my file.ts', meta: 'docs' },
    ]);
    render(() => <MessageInput sessionId="session-quoted-file" cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@myfile explain' } });
    await screen.findByText('my file.ts');
    fireEvent.click(screen.getByText('my file.ts'));

    expect(screen.getByText('my file.ts:L7-L9')).toBeDefined();

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith(
      '[File 1: my file.ts:L7-L9] explain',
      [expect.objectContaining({ refText: '@file:"docs/my file.ts":7-9' })],
      [
        expect.objectContaining({
          type: 'file_ref',
          refText: '@file:"docs/my file.ts":7-9',
          name: 'my file.ts',
          detail: 'docs/my file.ts:7-9',
          lineStart: 7,
          lineEnd: 9,
        }),
        expect.objectContaining({ type: 'text', text: ' explain' }),
      ],
    );
  });

  test('shows @ reference starters and turns a concrete file completion into a ref attachment chip', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockResolvedValue([
      { text: '@file:src/main.ts', display: 'main.ts', meta: 'src' },
    ]);
    render(() => <MessageInput sessionId="session-file" cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@' } });

    await screen.findByText('@file:');
    expect(screen.getByText('@git:')).toBeDefined();
    expect(screen.getByText('@image:')).toBeDefined();
    expect(screen.getByText('@tool:')).toBeDefined();
    fireEvent.click(screen.getByText('@file:'));
    expect(input.value).toBe('@file:');

    fireEvent.input(input, { target: { value: '@file:sr' } });
    await screen.findByText('main.ts');
    expect(screen.getByText('src')).toBeDefined();
    fireEvent.click(screen.getByText('main.ts'));

    expect(screen.getByText('main.ts')).toBeDefined();
    expect(input.value).toBe('');

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith(
      '[File 1: main.ts]',
      [expect.objectContaining({ kind: 'file', refText: '@file:src/main.ts' })],
      [
        expect.objectContaining({
          type: 'file_ref',
          anchor: 'File 1',
          name: 'main.ts',
          detail: 'src/main.ts',
          refText: '@file:src/main.ts',
        }),
      ],
    );
  });

  test('creates context chips for backend-expanded @ refs', async () => {
    const onSend = vi.fn();
    mocks.completePath.mockImplementation(({ partial }: { partial: string }) => {
      if (partial === '@') {
        return Promise.resolve({
          items: [
            { text: '@diff', display: '@diff', meta: 'git diff' },
            { text: '@staged', display: '@staged', meta: 'staged diff' },
          ],
        });
      }
      if (partial === '@git:3') {
        return Promise.resolve({ items: [{ text: '@git:3', display: '@git:3', meta: 'git log' }] });
      }
      if (partial === '@url:https://example.com') {
        return Promise.resolve({
          items: [{ text: '@url:https://example.com', display: 'https://example.com', meta: 'fetch url' }],
        });
      }
      return Promise.resolve({ items: [] });
    });
    render(() => <MessageInput sessionId="session-context" cwd="/repo" onSend={onSend} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@' } });

    await screen.findByText('@diff');
    fireEvent.click(screen.getByText('@diff'));
    expect(screen.getByText('@diff')).toBeDefined();
    expect(input.value).toBe('');

    fireEvent.input(input, { target: { value: '@git:' } });
    await screen.findByText('@git:');
    fireEvent.click(screen.getByText('@git:'));
    expect(input.value).toBe('@git:');

    fireEvent.input(input, { target: { value: '@git:3' } });
    await screen.findByText('git log');
    fireEvent.click(screen.getByText('@git:3'));

    fireEvent.input(input, { target: { value: '@url:' } });
    await screen.findByText('@url:');
    fireEvent.click(screen.getByText('@url:'));
    expect(input.value).toBe('@url:');

    fireEvent.input(input, { target: { value: '@url:https://example.com' } });
    await screen.findByText('https://example.com');
    fireEvent.click(screen.getByText('https://example.com'));

    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    expect(onSend).toHaveBeenCalledWith('', [
      expect.objectContaining({ kind: 'terminal', refText: '@diff' }),
      expect.objectContaining({ kind: 'terminal', refText: '@git:3' }),
      expect.objectContaining({ kind: 'url', refText: '@url:https://example.com' }),
    ]);
  });

  test('@image and @tool starters insert text only', async () => {
    render(() => <MessageInput sessionId="session-starters" cwd="/repo" onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@' } });

    await screen.findByText('@image:');
    fireEvent.click(screen.getByText('@image:'));
    expect(input.value).toBe('@image:');
    expect(mocks.openDialog).not.toHaveBeenCalled();

    fireEvent.input(input, { target: { value: '@' } });
    await screen.findByText('@tool:');
    fireEvent.click(screen.getByText('@tool:'));
    expect(input.value).toBe('@tool:');
    expect(mocks.openDialog).not.toHaveBeenCalled();
  });

  test('ignores stale @ completion responses from an old session or cwd', async () => {
    let resolveOld!: (value: unknown) => void;
    let setSession!: (sessionId: string) => void;
    let setCwd!: (cwd: string) => void;
    mocks.completePath.mockImplementation(({ cwd }: { cwd: string }) => {
      if (cwd === '/repo-a') {
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      }
      return Promise.resolve({ items: [{ text: '@file:new.ts', display: 'new.ts', meta: '' }] });
    });

    const Harness = () => {
      const [sessionId, updateSessionId] = createSignal('session-stale-a');
      const [cwd, updateCwd] = createSignal('/repo-a');
      setSession = updateSessionId;
      setCwd = updateCwd;
      return <MessageInput sessionId={sessionId()} cwd={cwd()} onSend={vi.fn()} />;
    };

    render(() => <Harness />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@file:o' } });

    await waitFor(() => {
      expect(mocks.completePath).toHaveBeenCalledWith({
        partial: '@file:o',
        sessionId: 'session-stale-a',
        cwd: '/repo-a',
      });
    });

    setSession('session-stale-b');
    setCwd('/repo-b');
    fireEvent.input(input, { target: { value: '@file:n' } });

    await screen.findByText('new.ts');
    resolveOld({ items: [{ text: '@file:old.ts', display: 'old.ts', meta: '' }] });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.getByText('new.ts')).toBeDefined();
    expect(screen.queryByText('old.ts')).toBeNull();
  });

  test('shows no results for empty workspace completions', async () => {
    mocks.completePath.mockResolvedValue({ items: [] });
    render(() => <MessageInput sessionId="session-empty" cwd="/empty-repo" onSend={vi.fn()} />);

    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@file:missing' } });

    await screen.findByText('No results');
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
    mocks.completePath.mockResolvedValue({
      items: [{ text: '@diff', display: '@diff', meta: 'git diff' }],
    });

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
    const input = screen.getByPlaceholderText('Message Hermes...') as HTMLTextAreaElement;
    fireEvent.input(input, { target: { value: '@' } });
    await screen.findByText('@diff');
    fireEvent.click(screen.getByText('@diff'));

    setSession('session-cwd-b');

    await waitFor(() => {
      expect(screen.queryByText('main.ts')).toBeNull();
    });

    setCwd('/repo-b');
    setSession('session-cwd-a');

    await waitFor(() => {
      expect(screen.queryByText('main.ts')).toBeNull();
      expect(screen.queryByText('@diff')).toBeNull();
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
