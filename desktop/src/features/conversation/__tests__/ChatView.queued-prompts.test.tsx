import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import type { Component, JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueuedPromptEntry } from '@/stores/composer-queue.js';

interface SteerResult {
  status?: 'queued' | 'rejected';
  text?: string;
}

const { state, chatMocks, queueMocks, cardMocks, gatewayMocks } = vi.hoisted(() => {
  const state = {
    messages: [] as Array<Record<string, unknown>>,
    queue: [] as QueuedPromptEntry[],
    streaming: false,
    gatewayConnected: true,
  };
  const chatMocks = {
    loadMessages: vi.fn(async () => undefined),
    clearError: vi.fn(),
    cancelMessage: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => true),
  };
  const queueMocks = {
    enqueue: vi.fn((sid: string, payload: { text: string; attachments?: QueuedPromptEntry['attachments'] }) => {
      const entry: QueuedPromptEntry = {
        id: `queued-${state.queue.length + 1}`,
        text: payload.text,
        attachments: payload.attachments ?? [],
        queuedAt: state.queue.length + 1,
      };
      state.queue = [...state.queue, entry];
      return entry;
    }),
    dequeue: vi.fn(),
    remove: vi.fn((sid: string, id: string) => {
      const entry = state.queue.find((item) => item.id === id) ?? null;
      state.queue = state.queue.filter((item) => item.id !== id);
      return entry;
    }),
  };
  const cardMocks = {
    setCommandCard: vi.fn(),
    dismissCommandCard: vi.fn(),
    noticeCard: vi.fn(),
  };
  const gatewayMocks = {
    steer: vi.fn(async (): Promise<SteerResult> => ({ status: 'queued' })),
  };
  return { state, chatMocks, queueMocks, cardMocks, gatewayMocks };
});

vi.mock('@solidjs/router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

vi.mock('@/stores/chat.js', () => ({
  chatStore: {
    getMessages: () => state.messages,
    getLiveState: () => ({
      activityBlocks: [],
      activeTools: [],
      pendingPermission: null,
      pendingClarify: null,
      pendingUserInput: null,
      memoryContext: null,
      todos: [],
      status: state.streaming ? 'streaming' : 'idle',
      turnId: null,
    }),
    isStreaming: () => state.streaming,
    getError: () => null,
    getErrorAction: () => null,
    isLoadingMessages: () => false,
    getDiagnostics: () => ({ lastEventAt: null, droppedLateEvents: 0 }),
    appendUserMessage: vi.fn(),
    sendMessage: chatMocks.sendMessage,
    markUserMessageFailed: vi.fn(),
    removeMessage: vi.fn(),
    removeLastTurn: vi.fn(),
    loadMessages: chatMocks.loadMessages,
    clearError: chatMocks.clearError,
    cancelMessage: chatMocks.cancelMessage,
    respondUserInput: vi.fn(),
    respondApproval: vi.fn(),
    respondSudo: vi.fn(),
    respondSecret: vi.fn(),
    respondClarify: vi.fn(),
  },
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSession: { id: 'sess-queue', title: 'Queue', cwd: '/repo', permissionMode: 'auto', runtime: { collaborationMode: 'default' } },
    activeSessionId: 'sess-queue',
    sessions: [{ id: 'sess-queue' }],
    setActiveSession: vi.fn(),
    getSessionModel: () => ({ provider: 'test', model: 'test-model' }),
    setSessionModel: vi.fn(),
    createSession: vi.fn(),
    branchSession: vi.fn(),
    updateCwd: vi.fn(),
    setPermissionMode: vi.fn(),
    updateRuntime: vi.fn(),
    applyCwd: vi.fn(),
  },
}));

vi.mock('@/stores/models.js', () => ({
  modelStore: {
    activeModel: { provider: 'test', model: 'test-model' },
    defaultModel: { provider: 'test', model: 'test-model' },
  },
}));

vi.mock('@/stores/ui.js', () => ({
  uiStore: {
    connectionState: 'connected',
    setConnectionState: vi.fn(),
    environmentPanelOpen: false,
    rightToolsOverlay: false,
    isTodoPanelDismissed: () => false,
    dismissTodoPanel: vi.fn(),
    restoreTodoPanel: vi.fn(),
  },
}));

vi.mock('@/stores/config.js', () => ({
  configStore: {
    config: {},
    loadConfig: vi.fn(async () => undefined),
  },
}));

vi.mock('@/stores/usage.js', () => ({
  sessionUsage: { get: () => undefined },
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => false,
    activeView: () => 'menu',
    toggle: vi.fn(),
    panelWidth: () => 420,
    setPanelWidth: vi.fn(),
  },
}));

vi.mock('@/stores/git-view.js', () => ({
  gitViewStore: { setWorkspace: vi.fn(), setWorkspacePath: vi.fn(), fetchDiff: vi.fn() },
}));

vi.mock('@/stores/workspace-tree.js', () => ({
  workspaceTreeStore: { setWorkspace: vi.fn(async () => undefined), setWorkspacePath: vi.fn() },
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => state.gatewayConnected
    ? {
      getConnectionState: () => 'connected',
      session: { steer: gatewayMocks.steer },
    }
    : null,
}));

vi.mock('@/stores/background-tasks.js', () => ({
  backgroundTaskStore: { dismiss: vi.fn() },
  recentBackgroundTasks: () => [],
}));

vi.mock('@/stores/composer-queue.js', () => ({
  composerQueueStore: {
    getQueuedPrompts: () => state.queue,
    enqueue: queueMocks.enqueue,
    dequeue: queueMocks.dequeue,
    remove: queueMocks.remove,
  },
  shouldAutoDrainOnSettle: () => false,
}));

vi.mock('../scrollController.js', () => ({
  createScrollController: () => ({
    isNearBottom: () => true,
    userScrolledUp: () => false,
    setUserScrolledUp: vi.fn(),
    unreadCount: () => 0,
    setUnreadCount: vi.fn(),
    resetScrollState: vi.fn(),
    handleScroll: vi.fn(),
    handleViewportResize: vi.fn(),
    scrollToBottom: vi.fn(),
    refs: { messagesEnd: undefined, messageList: undefined },
  }),
}));

vi.mock('../commandCardState.js', () => ({
  createCommandCardState: () => ({
    commandCard: () => null,
    setCommandCard: cardMocks.setCommandCard,
    dismissCommandCard: cardMocks.dismissCommandCard,
    noticeCard: cardMocks.noticeCard,
  }),
}));

vi.mock('../slashCommandRunner.js', () => ({
  createSlashCommandRunner: () => ({ handleSlashCommand: vi.fn() }),
}));

vi.mock('../eventSubscription.js', () => ({
  useGatewayEvents: vi.fn(),
}));

const stubComponent = (testId: string): Component<{ children?: JSX.Element }> => (props) => (
  <div data-testid={testId}>{props.children}</div>
);

vi.mock('../MessageBubble.js', () => ({ MessageBubble: stubComponent('message-bubble') }));
vi.mock('../AssistantMessage.js', () => ({ AssistantMessage: stubComponent('assistant-message') }));
vi.mock('../MessageInput.js', () => ({
  MessageInput: (props: { onSend: (text: string, attachments?: QueuedPromptEntry['attachments']) => void }) => (
    <button
      data-testid="queue-follow-up"
      type="button"
      onClick={() => props.onSend('queued follow-up', [{ id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' }])}
    >
      Queue follow-up
    </button>
  ),
}));
vi.mock('../cards/CommandCardDock.js', () => ({ CommandCardDock: stubComponent('command-card-dock') }));
vi.mock('../ModelSelector.js', () => ({ ModelSelector: stubComponent('model-selector') }));
vi.mock('../EmptyChatState.js', () => ({ EmptyChatState: stubComponent('empty-chat-state') }));
vi.mock('../ErrorBanner.js', () => ({ ErrorBanner: stubComponent('error-banner') }));
vi.mock('../ConversationRecoveryBanner.js', () => ({ ConversationRecoveryBanner: stubComponent('recovery-banner') }));
vi.mock('../ChatEnvironmentOverlay.js', () => ({ ChatEnvironmentOverlay: stubComponent('environment-overlay') }));
vi.mock('@/ui/atoms/Icon.js', () => ({ Icon: stubComponent('icon') }));
vi.mock('../ClarificationCard.js', () => ({ ClarificationCard: stubComponent('clarification-card') }));
vi.mock('../UserInputRequestCard.js', () => ({ UserInputRequestCard: stubComponent('user-input-card') }));
vi.mock('../MemoryContextCard.js', () => ({ MemoryContextCard: stubComponent('memory-context-card') }));
vi.mock('../TodoPanel.js', () => ({ TodoPanel: stubComponent('todo-panel') }));
vi.mock('../JumpToBottom.js', () => ({ JumpToBottom: stubComponent('jump-to-bottom') }));
vi.mock('../turn/PermissionRequestCard.js', () => ({ PermissionRequestCard: stubComponent('permission-card') }));
vi.mock('../background/BackgroundTaskDock.js', () => ({ BackgroundTaskDock: stubComponent('background-task-dock') }));

async function renderChatView() {
  const { ChatView } = await import('../ChatView.js');
  return render(() => <ChatView sessionId="sess-queue" />);
}

describe('ChatView queued follow-up UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.messages = [];
    state.queue = [];
    state.streaming = false;
    state.gatewayConnected = true;
    gatewayMocks.steer.mockResolvedValue({ status: 'queued' });

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('enqueues follow-up messages while streaming without showing the old notice card', async () => {
    state.streaming = true;
    await renderChatView();

    fireEvent.click(screen.getByTestId('queue-follow-up'));

    expect(queueMocks.enqueue).toHaveBeenCalledWith('sess-queue', {
      text: 'queued follow-up',
      attachments: [{ id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' }],
      displayParts: undefined,
    });
    expect(cardMocks.noticeCard).not.toHaveBeenCalledWith('Queued for the next turn.');
  });

  it('renders existing queued prompts in the prompt dock and removes a queued item', async () => {
    state.streaming = true;
    state.queue = [{
      id: 'queued-1',
      text: 'queued follow-up content',
      attachments: [{ id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' }],
      queuedAt: 1,
    }];
    await renderChatView();

    expect(screen.getByTestId('queued-prompt-dock')).toBeTruthy();
    expect(screen.getByText('queued follow-up content')).toBeTruthy();
    expect(screen.getByText('a.ts')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove queued message'));

    expect(queueMocks.remove).toHaveBeenCalledWith('sess-queue', 'queued-1');
  });

  it('steers the first queued text prompt and removes only that FIFO item when accepted', async () => {
    state.streaming = true;
    state.queue = [
      { id: 'queued-1', text: 'nudge the current run', attachments: [], queuedAt: 1 },
      { id: 'queued-2', text: 'keep this queued', attachments: [], queuedAt: 2 },
    ];
    await renderChatView();

    fireEvent.click(screen.getByRole('button', { name: 'Steer first queued follow-up' }));
    await Promise.resolve();

    expect(gatewayMocks.steer).toHaveBeenCalledWith('sess-queue', 'nudge the current run');
    expect(queueMocks.remove).toHaveBeenCalledWith('sess-queue', 'queued-1');
    expect(state.queue.map((entry) => entry.id)).toEqual(['queued-2']);
  });

  it('keeps the queued prompt and shows a notice when steer is rejected', async () => {
    gatewayMocks.steer.mockResolvedValue({ status: 'rejected' });
    state.streaming = true;
    state.queue = [{ id: 'queued-1', text: 'try steering', attachments: [], queuedAt: 1 }];
    await renderChatView();

    fireEvent.click(screen.getByRole('button', { name: 'Steer first queued follow-up' }));
    await Promise.resolve();

    expect(queueMocks.remove).not.toHaveBeenCalledWith('sess-queue', 'queued-1');
    expect(state.queue.map((entry) => entry.id)).toEqual(['queued-1']);
    expect(screen.getByText('Steer unavailable; still queued for next turn.')).toBeTruthy();
    expect(cardMocks.noticeCard).not.toHaveBeenCalledWith('Steer unavailable; still queued for next turn.');
  });

  it('keeps attachment-backed queued prompts disabled for steer', async () => {
    state.streaming = true;
    state.queue = [{
      id: 'queued-1',
      text: 'queued follow-up content',
      attachments: [{ id: 'file-a', kind: 'file', name: 'a.ts', path: '/repo/a.ts' }],
      queuedAt: 1,
    }];
    await renderChatView();

    const steer = screen.getByRole('button', { name: 'Steer first queued follow-up' }) as HTMLButtonElement;

    expect(steer.disabled).toBe(true);
    expect(steer.title).toBe('Queued follow-ups with attachments stay queued for the next turn.');
    expect(gatewayMocks.steer).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'display parts',
      streaming: true,
      gatewayConnected: true,
      entry: {
        id: 'queued-1',
        text: 'queued with display parts',
        attachments: [],
        displayParts: [{ type: 'text' as const, text: 'queued with display parts' }],
        queuedAt: 1,
      },
      reason: 'Queued follow-ups with attachments stay queued for the next turn.',
    },
    {
      name: 'slash command',
      streaming: true,
      gatewayConnected: true,
      entry: { id: 'queued-1', text: '/help now', attachments: [], queuedAt: 1 },
      reason: 'Slash commands stay queued for the next turn.',
    },
    {
      name: 'empty text',
      streaming: true,
      gatewayConnected: true,
      entry: { id: 'queued-1', text: '   ', attachments: [], queuedAt: 1 },
      reason: 'Cannot steer an empty queued follow-up.',
    },
    {
      name: 'idle turn',
      streaming: false,
      gatewayConnected: true,
      entry: { id: 'queued-1', text: 'queued follow-up', attachments: [], queuedAt: 1 },
      reason: 'No active turn to steer.',
    },
    {
      name: 'disconnected gateway',
      streaming: true,
      gatewayConnected: false,
      entry: { id: 'queued-1', text: 'queued follow-up', attachments: [], queuedAt: 1 },
      reason: 'Gateway is not connected.',
    },
  ])('disables steer for $name', async ({ streaming, gatewayConnected, entry, reason }) => {
    state.streaming = streaming;
    state.gatewayConnected = gatewayConnected;
    state.queue = [entry];
    await renderChatView();

    const steer = screen.getByRole('button', { name: 'Steer first queued follow-up' }) as HTMLButtonElement;

    expect(steer.disabled).toBe(true);
    expect(steer.title).toBe(reason);
    expect(gatewayMocks.steer).not.toHaveBeenCalled();
  });
});
