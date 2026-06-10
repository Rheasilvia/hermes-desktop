import { render } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable state shared with the hoisted vi.mock factories below.
const state = vi.hoisted(() => ({
  messages: [] as Array<Record<string, unknown>>,
  dismissed: new Set<string>(),
  liveTodos: [] as Array<Record<string, unknown>>,
  streaming: false,
}));

vi.mock('@solidjs/router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/stores/chat.js', () => ({
  chatStore: {
    getMessages: () => state.messages,
    getLiveState: () => ({
      activityBlocks: [],
      activeTools: [],
      pendingPermission: null,
      pendingClarify: null,
      memoryContext: null,
      todos: state.liveTodos,
      status: state.streaming ? 'streaming' : 'idle',
      turnId: null,
    }),
    isStreaming: () => state.streaming,
    getError: () => null,
    getErrorAction: () => null,
    isLoadingMessages: () => false,
    getDiagnostics: () => ({ lastEventAt: null, droppedLateEvents: 0 }),
    loadMessages: vi.fn(async () => undefined),
    clearError: vi.fn(),
    cancelMessage: vi.fn(),
  },
}));

vi.mock('@/stores/session.js', () => ({
  sessionStore: {
    activeSession: { id: 'sess-x', title: 'Todo', cwd: '/repo', permissionMode: 'auto' },
    activeSessionId: 'sess-x',
    sessions: [{ id: 'sess-x' }],
    setActiveSession: vi.fn(),
    getSessionModel: () => ({ provider: 'test', model: 'test-model' }),
    setSessionModel: vi.fn(),
    createSession: vi.fn(),
    branchSession: vi.fn(),
    updateCwd: vi.fn(),
    setPermissionMode: vi.fn(),
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
    isTodoPanelDismissed: (id: string) => state.dismissed.has(id),
    dismissTodoPanel: (id: string) => { state.dismissed.add(id); },
    restoreTodoPanel: (id: string) => { state.dismissed.delete(id); },
  },
}));

vi.mock('@/stores/usage.js', () => ({
  sessionUsage: { get: () => undefined },
}));

vi.mock('@/stores/side-panel.js', () => ({
  sidePanelStore: {
    isOpen: () => false,
    activeTab: () => 'workspace',
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
    isNearBottom: () => false,
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
    setCommandCard: vi.fn(),
    dismissCommandCard: vi.fn(),
    noticeCard: vi.fn(),
  }),
}));

vi.mock('../slashCommandRunner.js', () => ({
  createSlashCommandRunner: () => ({ handleSlashCommand: vi.fn() }),
}));

vi.mock('../eventSubscription.js', () => ({
  useGatewayEvents: vi.fn(),
}));

const stubComponent = (testId: string): Component<any> => (props) => (
  <div data-testid={testId}>{props.children}</div>
);

vi.mock('../MessageBubble.js', () => ({ MessageBubble: stubComponent('message-bubble') }));
vi.mock('../AssistantMessage.js', () => ({ AssistantMessage: stubComponent('assistant-message') }));
vi.mock('../MessageInput.js', () => ({ MessageInput: () => <div data-testid="message-input" /> }));
vi.mock('../cards/CommandCardDock.js', () => ({ CommandCardDock: stubComponent('command-card-dock') }));
vi.mock('../ModelSelector.js', () => ({ ModelSelector: stubComponent('model-selector') }));
vi.mock('../ChatToolbar.js', () => ({ ChatToolbar: stubComponent('chat-toolbar') }));
vi.mock('../WorkspaceSidePanel.js', () => ({ WorkspaceSidePanel: stubComponent('workspace-side-panel') }));
vi.mock('../EmptyChatState.js', () => ({ EmptyChatState: stubComponent('empty-chat-state') }));
vi.mock('../ErrorBanner.js', () => ({ ErrorBanner: stubComponent('error-banner') }));
vi.mock('../WorkspaceBanner.js', () => ({ WorkspaceBanner: stubComponent('workspace-banner') }));
vi.mock('../ConversationRecoveryBanner.js', () => ({ ConversationRecoveryBanner: stubComponent('recovery-banner') }));
vi.mock('@/ui/atoms/Icon.js', () => ({ Icon: stubComponent('icon') }));
vi.mock('../ClarificationCard.js', () => ({ ClarificationCard: stubComponent('clarification-card') }));
vi.mock('../MemoryContextCard.js', () => ({ MemoryContextCard: stubComponent('memory-context-card') }));
vi.mock('../TodoPanel.js', () => ({ TodoPanel: stubComponent('todo-panel') }));
vi.mock('../JumpToBottom.js', () => ({ JumpToBottom: stubComponent('jump-to-bottom') }));
// NOTE: PromptDock is intentionally NOT stubbed — it renders the `items` array
// (including the floating todo panel), so the real component is needed to observe
// whether the panel is shown.
vi.mock('../turn/PermissionRequestCard.js', () => ({ PermissionRequestCard: stubComponent('permission-request-card') }));
vi.mock('../background/BackgroundTaskDock.js', () => ({ BackgroundTaskDock: stubComponent('background-task-dock') }));

function assistantWithTodos(todos: Array<{ id: string; content: string; status: string }>) {
  return {
    id: 'msg-assistant',
    sessionId: 'sess-x',
    role: 'assistant',
    blocks: [{ type: 'todo_list', id: 'tl-1', toolId: 'todo', todos }],
    timestamp: 1,
    tokenCount: null,
    finishReason: null,
    isStreaming: false,
    actions: [],
    toolName: null,
  };
}

describe('ChatView floating todo panel — persisted dismissal on hydration', () => {
  beforeEach(() => {
    state.messages = [];
    state.dismissed = new Set<string>();
    state.liveTodos = [];
    state.streaming = false;

    class ResizeObserverMock {
      observe = vi.fn();
      disconnect = vi.fn();
    }
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not re-show the panel for a dismissed session even with a completed todo_list block', async () => {
    // Simulates restart of a session that finished its todos (panel had auto-hidden).
    state.dismissed.add('sess-x');
    state.messages = [assistantWithTodos([
      { id: '1', content: 'a', status: 'completed' },
      { id: '2', content: 'b', status: 'completed' },
    ])];

    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="sess-x" />);

    expect(rendered.queryByTestId('todo-panel')).toBeNull();
  });

  it('shows the panel on hydration when todos are unfinished and the session was not dismissed', async () => {
    state.messages = [assistantWithTodos([
      { id: '1', content: 'a', status: 'completed' },
      { id: '2', content: 'b', status: 'pending' },
    ])];

    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="sess-x" />);

    expect(rendered.queryByTestId('todo-panel')).not.toBeNull();
  });

  it('does NOT flash the panel on a normal turn when the only todos are a completed historical list', async () => {
    // The reported bug: a list finished, then a normal (no-todo) message streams. The
    // turn-start reset effect clears the dismissed flag, but a fully-completed historical
    // list must not re-surface during ordinary conversation.
    state.streaming = true;   // a normal conversation turn is in progress
    state.liveTodos = [];     // ...with no todos of its own
    state.messages = [assistantWithTodos([
      { id: '1', content: 'a', status: 'completed' },
      { id: '2', content: 'b', status: 'completed' },
    ])];

    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="sess-x" />);

    expect(rendered.queryByTestId('todo-panel')).toBeNull();
  });

  it('still shows the panel during a live turn whose todos just all completed (done moment)', async () => {
    state.streaming = true;
    state.liveTodos = [
      { id: '1', content: 'a', status: 'completed' },
      { id: '2', content: 'b', status: 'completed' },
    ];

    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="sess-x" />);

    expect(rendered.queryByTestId('todo-panel')).not.toBeNull();
  });
});
