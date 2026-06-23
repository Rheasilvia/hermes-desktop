import { render } from '@solidjs/testing-library';
import type { Component } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScrollController } from '../scrollController';

const handleViewportResize = vi.fn();
const observe = vi.fn();
const disconnect = vi.fn();
let resizeObserverRecords: Array<{
  callback: ResizeObserverCallback;
  targets: Element[];
}> = [];

const uiState = vi.hoisted(() => ({
  environmentPanelOpen: true,
  rightToolsOverlay: false,
}));

vi.mock('@solidjs/router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/stores/chat.js', () => ({
  chatStore: {
    getMessages: () => [{
      id: 'msg-1',
      sessionId: 'session-resize',
      role: 'user',
      blocks: [{ type: 'text', id: 'block-1', content: 'hello' }],
      timestamp: 1,
      tokenCount: null,
      finishReason: null,
      isStreaming: false,
      actions: [],
      toolName: null,
    }],
    getLiveState: () => ({
      activityBlocks: [],
      activeTools: [],
      pendingPermission: null,
      pendingClarify: null,
      pendingUserInput: null,
      memoryContext: null,
      todos: [],
      status: 'idle',
      turnId: null,
    }),
    isStreaming: () => false,
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
    activeSession: { id: 'session-resize', title: 'Resize', cwd: '/repo', permissionMode: 'auto' },
    activeSessionId: 'session-resize',
    sessions: [{ id: 'session-resize' }],
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
    get environmentPanelOpen() { return uiState.environmentPanelOpen; },
    get rightToolsOverlay() { return uiState.rightToolsOverlay; },
    isTodoPanelDismissed: () => false,
    dismissTodoPanel: vi.fn(),
    restoreTodoPanel: vi.fn(),
  },
}));

vi.mock('@/stores/usage.js', () => ({
  sessionUsage: {
    get: () => undefined,
  },
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
  gitViewStore: {
    setWorkspace: vi.fn(),
    setWorkspacePath: vi.fn(),
    fetchDiff: vi.fn(),
  },
}));

vi.mock('@/stores/workspace-tree.js', () => ({
  workspaceTreeStore: {
    setWorkspace: vi.fn(async () => undefined),
    setWorkspacePath: vi.fn(),
  },
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
  createScrollController: (): ScrollController => ({
    isNearBottom: () => false,
    userScrolledUp: () => false,
    setUserScrolledUp: vi.fn(),
    unreadCount: () => 0,
    setUnreadCount: vi.fn(),
    resetScrollState: vi.fn(),
    handleScroll: vi.fn(),
    handleViewportResize,
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
  createSlashCommandRunner: () => ({
    handleSlashCommand: vi.fn(),
  }),
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
vi.mock('../RightToolPanel.js', () => ({ RightToolPanel: stubComponent('right-tool-panel') }));
vi.mock('../EmptyChatState.js', () => ({ EmptyChatState: stubComponent('empty-chat-state') }));
vi.mock('../ErrorBanner.js', () => ({ ErrorBanner: stubComponent('error-banner') }));
vi.mock('../ConversationRecoveryBanner.js', () => ({ ConversationRecoveryBanner: stubComponent('recovery-banner') }));
vi.mock('../EnvironmentPanel.js', () => ({
  EnvironmentPanel: (props: { sessionId: string | null; workspacePath: string | null }) => (
    <aside
      data-testid="environment-panel"
      data-session-id={props.sessionId ?? ''}
      data-workspace-path={props.workspacePath ?? ''}
    />
  ),
}));
vi.mock('@/ui/atoms/Icon.js', () => ({ Icon: stubComponent('icon') }));
vi.mock('../ClarificationCard.js', () => ({ ClarificationCard: stubComponent('clarification-card') }));
vi.mock('../MemoryContextCard.js', () => ({ MemoryContextCard: stubComponent('memory-context-card') }));
vi.mock('../TodoPanel.js', () => ({ TodoPanel: stubComponent('todo-panel') }));
vi.mock('../JumpToBottom.js', () => ({ JumpToBottom: stubComponent('jump-to-bottom') }));
vi.mock('../turn/PromptDock.js', () => ({ PromptDock: stubComponent('prompt-dock') }));
vi.mock('../turn/PermissionRequestCard.js', () => ({ PermissionRequestCard: stubComponent('permission-request-card') }));
vi.mock('../background/BackgroundTaskDock.js', () => ({ BackgroundTaskDock: stubComponent('background-task-dock') }));

describe('ChatView composer resize anchoring', () => {
  beforeEach(() => {
    handleViewportResize.mockClear();
    observe.mockClear();
    disconnect.mockClear();
    resizeObserverRecords = [];
    uiState.environmentPanelOpen = true;
    uiState.rightToolsOverlay = false;

    class ResizeObserverMock {
      private readonly record: { callback: ResizeObserverCallback; targets: Element[] };

      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, targets: [] };
        resizeObserverRecords.push(this.record);
      }

      observe = (element: Element) => {
        observe(element);
        this.record.targets.push(element);
      };
      disconnect = disconnect;
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('observes the composer input target and anchors the current conversation when it resizes', async () => {
    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="session-resize" />);

    const observedTargets = observe.mock.calls.map((call) => call[0] as HTMLElement);
    const composerTarget = observedTargets.find((target) => target.contains(rendered.getByTestId('message-input')));

    expect(composerTarget).toBeDefined();
    expect(composerTarget?.contains(rendered.getByTestId('jump-to-bottom'))).toBe(false);
    expect(composerTarget?.contains(rendered.getByTestId('prompt-dock'))).toBe(false);

    for (const record of resizeObserverRecords) {
      record.callback([], {} as ResizeObserver);
    }

    expect(handleViewportResize).toHaveBeenCalledTimes(1);
    rendered.unmount();
    expect(disconnect).toHaveBeenCalledTimes(resizeObserverRecords.length);
  });

  it('renders the Environment panel inside the chat body and reserves internal chat space', async () => {
    const { ChatView } = await import('../ChatView.js');
    const rendered = render(() => <ChatView sessionId="session-resize" />);
    const chatBody = rendered.getByTestId('chat-body');
    const chatBodyObserver = resizeObserverRecords.find((record) => record.targets.includes(chatBody));

    chatBodyObserver?.callback([
      { contentRect: { width: 1320 } } as ResizeObserverEntry,
    ], {} as ResizeObserver);

    const popover = rendered.getByTestId('environment-panel-popover');
    expect(popover.parentElement).toBe(chatBody);
    expect(rendered.getByTestId('environment-panel').getAttribute('data-session-id')).toBe('session-resize');
    expect(rendered.getByTestId('environment-panel').getAttribute('data-workspace-path')).toBe('/repo');
    expect(rendered.getByTestId('chat-message-list').className).toContain('messageListWithEnvironment');
    expect(rendered.getByTestId('chat-input-area').className).toContain('inputAreaWithEnvironment');
  });

  it('hides the Environment panel when disabled, overlayed, or too narrow', async () => {
    const { ChatView } = await import('../ChatView.js');

    uiState.environmentPanelOpen = false;
    let rendered = render(() => <ChatView sessionId="session-resize" />);
    resizeObserverRecords
      .find((record) => record.targets.includes(rendered.getByTestId('chat-body')))
      ?.callback([{ contentRect: { width: 1320 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(rendered.queryByTestId('environment-panel-popover')).toBeNull();
    expect(rendered.getByTestId('chat-message-list').className).not.toContain('messageListWithEnvironment');
    rendered.unmount();

    uiState.environmentPanelOpen = true;
    uiState.rightToolsOverlay = true;
    rendered = render(() => <ChatView sessionId="session-resize" />);
    resizeObserverRecords
      .find((record) => record.targets.includes(rendered.getByTestId('chat-body')))
      ?.callback([{ contentRect: { width: 1320 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(rendered.queryByTestId('environment-panel-popover')).toBeNull();
    rendered.unmount();

    uiState.rightToolsOverlay = false;
    rendered = render(() => <ChatView sessionId="session-resize" />);
    resizeObserverRecords
      .find((record) => record.targets.includes(rendered.getByTestId('chat-body')))
      ?.callback([{ contentRect: { width: 900 } } as ResizeObserverEntry], {} as ResizeObserver);
    expect(rendered.queryByTestId('environment-panel-popover')).toBeNull();
    expect(rendered.getByTestId('chat-input-area').className).not.toContain('inputAreaWithEnvironment');
    rendered.unmount();
  });
});
