import { cleanup, render } from '@solidjs/testing-library';
import type { Component, JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type LiveStatus = 'idle' | 'submitting' | 'accepted' | 'streaming' | 'tool_running' | 'awaiting_user' | 'stalled';

const { state, chatMocks, uiMocks, cardMocks } = vi.hoisted(() => {
  const state = {
    liveState: {} as Record<string, unknown>,
    messages: [] as Array<Record<string, unknown>>,
    dismissed: new Set<string>(),
    commandCard: null as null | { cardType: 'notice'; text: string },
  };
  const chatMocks = {
    loadMessages: vi.fn(async () => undefined),
    clearError: vi.fn(),
    cancelMessage: vi.fn(async () => undefined),
    respondUserInput: vi.fn(async () => undefined),
    respondApproval: vi.fn(async () => undefined),
    respondSudo: vi.fn(async () => undefined),
    respondSecret: vi.fn(async () => undefined),
    respondClarify: vi.fn(async () => undefined),
  };
  const uiMocks = {
    dismissTodoPanel: vi.fn((id: string) => { state.dismissed.add(id); }),
    restoreTodoPanel: vi.fn((id: string) => { state.dismissed.delete(id); }),
  };
  const cardMocks = {
    setCommandCard: vi.fn((card: { cardType: 'notice'; text: string } | null) => { state.commandCard = card; }),
    dismissCommandCard: vi.fn(() => { state.commandCard = null; }),
    noticeCard: vi.fn(),
  };
  return { state, chatMocks, uiMocks, cardMocks };
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
    getLiveState: () => state.liveState,
    isStreaming: () => {
      const status = state.liveState.status;
      return status === 'submitting' ||
        status === 'accepted' ||
        status === 'streaming' ||
        status === 'tool_running' ||
        status === 'awaiting_user' ||
        status === 'stalled';
    },
    getError: () => null,
    getErrorAction: () => null,
    isLoadingMessages: () => false,
    getDiagnostics: () => ({ lastEventAt: null, droppedLateEvents: 0 }),
    appendUserMessage: vi.fn(),
    sendMessage: vi.fn(async () => true),
    markUserMessageFailed: vi.fn(),
    removeMessage: vi.fn(),
    removeLastTurn: vi.fn(),
    loadMessages: chatMocks.loadMessages,
    clearError: chatMocks.clearError,
    cancelMessage: chatMocks.cancelMessage,
    respondUserInput: chatMocks.respondUserInput,
    respondApproval: chatMocks.respondApproval,
    respondSudo: chatMocks.respondSudo,
    respondSecret: chatMocks.respondSecret,
    respondClarify: chatMocks.respondClarify,
  },
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSession: { id: 'sess-esc', title: 'Esc', cwd: '/repo', permissionMode: 'auto', runtime: { collaborationMode: 'default' } },
    activeSessionId: 'sess-esc',
    sessions: [{ id: 'sess-esc' }],
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
    isTodoPanelDismissed: (id: string) => state.dismissed.has(id),
    dismissTodoPanel: uiMocks.dismissTodoPanel,
    restoreTodoPanel: uiMocks.restoreTodoPanel,
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
  getGateway: () => null,
}));

vi.mock('@/stores/background-tasks.js', () => ({
  backgroundTaskStore: { dismiss: vi.fn() },
  recentBackgroundTasks: () => [],
}));

vi.mock('@/stores/composer-queue.js', () => ({
  composerQueueStore: {
    getQueuedPrompts: () => [],
    dequeue: vi.fn(),
    enqueue: vi.fn(),
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
    commandCard: () => state.commandCard,
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
vi.mock('../MessageInput.js', () => ({ MessageInput: () => <div data-testid="message-input" /> }));
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
vi.mock('../turn/PromptDock.js', () => ({
  PromptDock: (props: { items: Array<{ id: string; content: JSX.Element }> }) => (
    <div data-testid="prompt-dock">
      {props.items.map((item) => <div data-testid={`dock-${item.id}`}>{item.content}</div>)}
    </div>
  ),
}));
vi.mock('../turn/PermissionRequestCard.js', () => ({ PermissionRequestCard: stubComponent('permission-card') }));
vi.mock('../background/BackgroundTaskDock.js', () => ({ BackgroundTaskDock: stubComponent('background-task-dock') }));

function liveState(status: LiveStatus = 'idle', overrides: Record<string, unknown> = {}) {
  return {
    activityBlocks: [],
    activeTools: [],
    pendingPermission: null,
    pendingClarify: null,
    pendingUserInput: null,
    memoryContext: null,
    todos: [],
    status,
    turnId: null,
    ...overrides,
  };
}

async function renderChatView() {
  const { ChatView } = await import('../ChatView.js');
  return render(() => <ChatView sessionId="sess-esc" />);
}

function pressEscape(init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...init,
  });
  window.dispatchEvent(event);
  return event;
}

describe('ChatView Escape routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.liveState = liveState();
    state.messages = [];
    state.dismissed = new Set<string>();
    state.commandCard = null;

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    document.querySelectorAll('[role="dialog"], [data-context-menu], [data-completion-panel]').forEach((node) => node.remove());
  });

  it('submits empty answers for a pending user input request', async () => {
    state.liveState = liveState('awaiting_user', {
      pendingUserInput: {
        requestId: 'req-user',
        questions: [
          { id: 'scope', header: 'Scope', question: 'Scope?', options: [] },
          { id: 'density', header: 'Density', question: 'Density?', options: [] },
        ],
      },
    });
    await renderChatView();

    pressEscape();

    expect(chatMocks.respondUserInput).toHaveBeenCalledWith('sess-esc', 'req-user', {
      scope: { answers: [] },
      density: { answers: [] },
    });
    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('cancels approval and masked permission prompts', async () => {
    await renderChatView();

    state.liveState = liveState('awaiting_user', {
      pendingPermission: { kind: 'approval', command: 'rm -rf tmp', description: 'Needs approval' },
    });
    pressEscape();
    expect(chatMocks.respondApproval).toHaveBeenCalledWith('sess-esc', 'deny');

    state.liveState = liveState('awaiting_user', {
      pendingPermission: { kind: 'sudo', command: 'sudo', requestId: 'sudo-1' },
    });
    pressEscape();
    expect(chatMocks.respondSudo).toHaveBeenCalledWith('sess-esc', 'sudo-1', '');

    state.liveState = liveState('awaiting_user', {
      pendingPermission: { kind: 'secret', command: 'TOKEN', requestId: 'secret-1' },
    });
    pressEscape();
    expect(chatMocks.respondSecret).toHaveBeenCalledWith('sess-esc', 'secret-1', '');
    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('submits an empty clarification response', async () => {
    state.liveState = liveState('awaiting_user', {
      pendingClarify: { requestId: 'clarify-1', question: 'Which path?', choices: null },
    });
    await renderChatView();

    pressEscape();

    expect(chatMocks.respondClarify).toHaveBeenCalledWith('sess-esc', 'clarify-1', '');
    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('dismisses a command card before stopping a streaming turn', async () => {
    state.commandCard = { cardType: 'notice', text: 'Queued' };
    state.liveState = liveState('streaming');
    await renderChatView();

    pressEscape();

    expect(cardMocks.dismissCommandCard).toHaveBeenCalledTimes(1);
    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('routes Escape to the floating todo panel without stopping twice', async () => {
    state.liveState = liveState('streaming', {
      todos: [{ id: 'todo-1', content: 'Finish', status: 'pending' }],
    });
    await renderChatView();

    pressEscape();

    expect(chatMocks.cancelMessage).toHaveBeenCalledTimes(1);
    expect(chatMocks.cancelMessage).toHaveBeenCalledWith('sess-esc');
  });

  it('stops the active turn when no chat panel is active', async () => {
    state.liveState = liveState('streaming');
    await renderChatView();

    pressEscape();

    expect(chatMocks.cancelMessage).toHaveBeenCalledTimes(1);
    expect(chatMocks.cancelMessage).toHaveBeenCalledWith('sess-esc');
  });

  it('does nothing while idle with no active panel', async () => {
    state.liveState = liveState('idle');
    await renderChatView();

    const event = pressEscape();

    expect(event.defaultPrevented).toBe(false);
    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('ignores modified, repeated, prevented, and higher-priority Escape events', async () => {
    state.liveState = liveState('streaming');
    await renderChatView();

    pressEscape({ metaKey: true });
    pressEscape({ repeat: true });
    const prevented = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    prevented.preventDefault();
    window.dispatchEvent(prevented);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    pressEscape();
    dialog.remove();

    const contextMenu = document.createElement('div');
    contextMenu.setAttribute('data-context-menu', '');
    document.body.appendChild(contextMenu);
    pressEscape();
    contextMenu.remove();

    const completion = document.createElement('div');
    completion.setAttribute('data-completion-panel', '');
    document.body.appendChild(completion);
    pressEscape();

    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });

  it('removes the Escape listener on unmount', async () => {
    state.liveState = liveState('streaming');
    const rendered = await renderChatView();
    rendered.unmount();

    pressEscape();

    expect(chatMocks.cancelMessage).not.toHaveBeenCalled();
  });
});
