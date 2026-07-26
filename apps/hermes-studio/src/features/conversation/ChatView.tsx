import type { Component } from 'solid-js';
import { Show, For, createEffect, onMount, onCleanup, createMemo, createSignal, Switch, Match, untrack } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import type { TodoItem, UserInputAnswersPayload, UserInputQuestionPayload } from '@/types/gateway.js';
import type { CollaborationMode, DesktopPermissionMode } from '@/types/index.js';
import type { PlanBlock, RenderedMessage, TodoListBlock } from '@/types/index.js';
import type { MessageActionType } from '@/types/ui/message.js';
import { chatStore } from '@/stores/chat.js';
import { sessionUsage } from '@/stores/usage.js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { gitViewStore } from '@/stores/git-view.js';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
import { sessionStore } from '@/stores/session.js';
import { modelStore } from '@/stores/models.js';
import { uiStore } from '@/stores/ui.js';
import { configStore } from '@/stores/config.js';
import { getGateway } from '@/stores/context.js';
import { getVoiceRecordingLimit, isAutoTtsEnabled, isSttEnabled, isTtsAvailable } from '@/lib/voice/voice-config.js';
import { playSpeechText } from '@/lib/voice/voice-playback.js';
import type { CommandResult, ConnectionState } from '@/services/gateway/types.js';
import { ROUTES } from '@/routes';
import { MessageBubble } from './MessageBubble.js';
import { AssistantMessage } from './AssistantMessage.js';
import type { MessageBlock, TextBlock } from '@/types/index.js';
import { MessageInput } from './MessageInput.js';
import type { AttachmentChip } from './composer/AttachmentChips.js';
import { sanitizeAttachmentChips } from './composer/attachmentSanitizer.js';
import {
  attachmentsFromDisplayParts,
  llmMessageFromDisplayParts,
  normalizeDisplayPartAnchors,
  type UserDisplayPart,
} from './display-parts.js';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { CommandCardDock } from './cards/CommandCardDock.js';
import { ModelSelector } from './ModelSelector.js';
import { EmptyChatState } from './EmptyChatState.js';
import { ErrorBanner } from './ErrorBanner.js';
import { ConversationRecoveryBanner } from './ConversationRecoveryBanner.js';
import { ChatEnvironmentOverlay } from './ChatEnvironmentOverlay.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { ClarificationCard } from './ClarificationCard.js';
import { UserInputRequestCard } from './UserInputRequestCard.js';
import { MemoryContextCard } from './MemoryContextCard.js';
import { QueuedPromptDock } from './QueuedPromptDock.js';
import { TodoPanel } from './TodoPanel.js';
import { JumpToBottom } from './JumpToBottom.js';
import { PromptDock, type PromptDockItem } from './turn/PromptDock.js';
import { PermissionRequestCard } from './turn/PermissionRequestCard.js';
import { BackgroundTaskDock } from './background/BackgroundTaskDock.js';
import { backgroundTaskStore, recentBackgroundTasks } from '@/stores/background-tasks.js';
import { composerQueueStore, shouldAutoDrainOnSettle, type QueuedAttachment } from '@/stores/composer-queue.js';
import { composerInsertionStore } from '@/stores/composer-insertions.js';
import { previewStore } from '@/stores/preview.js';
import { createScrollController } from './scrollController.js';
import { createCommandCardState } from './commandCardState.js';
import { createSlashCommandRunner } from './slashCommandRunner.js';
import { useGatewayEvents } from './eventSubscription.js';
import { shouldShowEnvironmentOverlay } from './environmentOverlay.js';
import {
  MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT,
  MESSAGE_VIRTUAL_ROW_HEIGHT,
  virtualizeMessages,
} from './messageVirtualization.js';
import styles from './ChatView.module.css';

interface ChatViewProps {
  sessionId?: string;
}

interface QueuedEditPayload {
  text: string;
  attachments: AttachmentChip[];
  displayParts?: UserDisplayPart[];
}

interface InlineUserEditState {
  messageId: RenderedMessage['id'];
  turnId: string | null;
  draft: string;
  pending: boolean;
  error: string | null;
}

export type EditedPromptResolution =
  | { kind: 'prompt'; text: string; display?: PromptDisplayMetadata }
  | { kind: 'blocked'; message: string };

const ESCAPE_PRIORITY_SURFACE_SELECTOR = [
  '[role="dialog"][aria-modal="true"]',
  '[data-context-menu]',
  '[data-completion-panel]',
].join(',');
const STEER_UNAVAILABLE_WARNING = 'Steer unavailable; still queued for next turn.';
const EXECUTE_PLAN_MESSAGE = 'Implement this plan.';

export interface ActionablePlanKey {
  messageId: RenderedMessage['id'];
  blockId: string;
}

export interface PromptDisplayMetadata {
  text: string;
  slashCommand?: { command: string; args: string };
}

export interface PromptDispatchPayload {
  message: string;
  context?: string;
  slashCommand?: { command: string; args: string };
}

export function resolvePromptDispatch(
  submitText: string,
  displayText: string,
  display?: PromptDisplayMetadata,
  attachmentContext?: string,
): PromptDispatchPayload {
  const slashCommand = display?.slashCommand;
  if (slashCommand) {
    return {
      message: displayText,
      context: [attachmentContext, submitText].filter(Boolean).join('\n\n'),
      slashCommand,
    };
  }
  if (attachmentContext) {
    return { message: submitText, context: attachmentContext };
  }
  return { message: submitText };
}

export function buildPlanExecutionContext(planContent: string): string {
  const trimmed = planContent.trim();
  return trimmed ? `Approved plan:\n\n${trimmed}` : '';
}

export function resolveActionablePlanKey(
  messages: RenderedMessage[],
  isStreaming: boolean,
): ActionablePlanKey | null {
  if (isStreaming) return null;
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage || lastMessage.role !== 'assistant' || lastMessage.isStreaming) return null;

  for (let idx = lastMessage.blocks.length - 1; idx >= 0; idx -= 1) {
    const block = lastMessage.blocks[idx];
    if (block.type === 'plan' && !block.isStreaming) {
      return { messageId: lastMessage.id, blockId: block.id };
    }
  }
  return null;
}

export function isUserTurnBoundary(
  messages: RenderedMessage[],
  index: number,
  hasDateSeparator: boolean,
): boolean {
  if (hasDateSeparator || index <= 0) return false;
  const current = messages[index];
  const previous = messages[index - 1];
  return previous?.role === 'assistant' && current?.role === 'user';
}

export function resolveMessageCopyText(message: RenderedMessage): string {
  if (message.role === 'user' && message.slashCommand) {
    const { command, args } = message.slashCommand;
    return args ? `/${command} ${args}` : `/${command}`;
  }
  return message.blocks
    .filter((b): b is TextBlock | PlanBlock => b.type === 'text' || b.type === 'plan')
    .map((b) => b.content)
    .join('\n');
}

export function resolveMessageEditDraft(message: RenderedMessage): string {
  if (message.slashCommand) {
    const { command, args } = message.slashCommand;
    return args ? `/${command} ${args}` : `/${command}`;
  }
  return message.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.content)
    .join('\n')
    .trim();
}

export function resolveMessageRestoreDisplayParts(
  message: RenderedMessage,
  draftText: string,
): UserDisplayPart[] | undefined {
  const fileRefs = normalizeDisplayPartAnchors(
    (message.displayParts ?? []).filter((part) => part.type === 'file_ref'),
  );
  if (fileRefs.length === 0) return undefined;

  let displayText = draftText.trim();
  for (const part of fileRefs) {
    const marker = llmMessageFromDisplayParts([part]);
    if (!marker) continue;
    displayText = displayText.replace(marker, '').replace(/[ \t]{2,}/g, ' ').trim();
  }

  return normalizeDisplayPartAnchors([
    ...fileRefs,
    ...(displayText ? [{ type: 'text' as const, text: displayText }] : []),
  ]);
}

function messageHasImageAttachment(message: RenderedMessage): boolean {
  const attachments = message.attachments ?? [];
  return attachments.some((attachment) => {
    const item = attachment as { kind?: string; type?: string };
    return item.kind === 'image' || item.type === 'image';
  }) || (message.displayParts ?? []).some((part) => part.type === 'image');
}

function commandResultBlockedMessage(result: CommandResult): string {
  switch (result.kind) {
    case 'action':
      return 'This slash command changes the app state and cannot be restored from history.';
    case 'card':
      return result.text || 'This slash command opens a card and cannot be restored from history.';
    case 'error':
    case 'unsupported':
    case 'output':
      return result.message || 'This slash command cannot be restored from history.';
    default:
      return 'This slash command cannot be restored from history.';
  }
}

export function resolveEditedSlashCommandResult(
  command: string,
  args: string,
  result: CommandResult,
): EditedPromptResolution {
  if (result.kind === 'skill') {
    const compact = args ? `/${command} ${args}` : `/${command}`;
    return {
      kind: 'prompt',
      text: result.message,
      display: { text: compact, slashCommand: { command, args } },
    };
  }
  if (result.kind === 'send') {
    return { kind: 'prompt', text: result.message };
  }
  return { kind: 'blocked', message: commandResultBlockedMessage(result) };
}

function emptyUserInputAnswers(questions: UserInputQuestionPayload[]): UserInputAnswersPayload {
  const answers: UserInputAnswersPayload = {};
  for (const question of questions) {
    answers[question.id] = { answers: [] };
  }
  return answers;
}

function isPlainEscape(event: KeyboardEvent): boolean {
  return event.key === 'Escape' &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey;
}

function eventPathHasPrioritySurface(event: KeyboardEvent): boolean {
  const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
  return path.some((target) =>
    target instanceof Element && target.matches(ESCAPE_PRIORITY_SURFACE_SELECTOR)
  );
}

export const ChatView: Component<ChatViewProps> = (props) => {
  const navigate = useNavigate();
  const sessionId = () => props.sessionId ?? '';
  let rootRef: HTMLDivElement | undefined;
  let chatBodyRef: HTMLDivElement | undefined;
  let messageInputResizeRef: HTMLDivElement | undefined;
  const [editDraft, setEditDraft] = createSignal<string | null>(null);
  const [inlineEdit, setInlineEdit] = createSignal<InlineUserEditState | null>(null);
  const [editQueuedPayload, setEditQueuedPayload] = createSignal<QueuedEditPayload | null>(null);
  const [connectionState, setConnectionState] = createSignal<ConnectionState>(uiStore.connectionState);
  const [chatBodyWidth, setChatBodyWidth] = createSignal<number | null>(null);
  const [messageScrollTop, setMessageScrollTop] = createSignal(0);
  const [messageViewportHeight, setMessageViewportHeight] = createSignal(MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT);
  const [messageListMounted, setMessageListMounted] = createSignal(false);
  const [steeringQueuedId, setSteeringQueuedId] = createSignal<string | null>(null);
  const [queuedSteerWarning, setQueuedSteerWarning] = createSignal<string | null>(null);
  let wasBusy = false;
  let suppressNextAutoDrain = false;
  let escapePrioritySurfaceAtKeydown = false;
  let lastComposerSubmissionId = 0;
  const autoTtsPlayed = new Set<string>();

  const cwd = createMemo(() => sessionStore.activeSession?.cwd ?? null);
  const messages = (): RenderedMessage[] => chatStore.getMessages(sessionId());
  const liveState = () => chatStore.getLiveState(sessionId());
  const isStreaming = (): boolean => chatStore.isStreaming(sessionId());
  const actionablePlanKey = createMemo(() => resolveActionablePlanKey(messages(), isStreaming()));
  const error = (): string | null => chatStore.getError(sessionId());
  const errorAction = () => chatStore.getErrorAction(sessionId());
  const isEmpty = createMemo(() => messages().length === 0);
  const canEditWorkspace = createMemo(() => !messages().some((m) => m.role === 'assistant'));
  const isLoading = () => chatStore.isLoadingMessages(sessionId());
  const diagnostics = createMemo(() => chatStore.getDiagnostics(sessionId()));
  const permissionMode = createMemo(() => sessionStore.activeSession?.permissionMode ?? 'auto');
  const collaborationMode = createMemo<CollaborationMode>(() => sessionStore.activeSession?.runtime?.collaborationMode ?? 'default');
  const voiceConfig = createMemo(() => configStore.config);
  const sttEnabled = createMemo(() => isSttEnabled(voiceConfig()));
  const maxVoiceRecordingSeconds = createMemo(() => getVoiceRecordingLimit(voiceConfig()));
  const [permissionModePending, setPermissionModePending] = createSignal(false);
  const [permissionModeAppliesNextTurn, setPermissionModeAppliesNextTurn] = createSignal(false);
  const [collaborationModePending, setCollaborationModePending] = createSignal(false);
  const environmentPanelVisible = createMemo(() => shouldShowEnvironmentOverlay({
    chatBodyWidth: chatBodyWidth(),
    environmentPanelOpen: uiStore.environmentPanelOpen,
    rightToolsOverlay: uiStore.rightToolsOverlay,
  }));

  const handleOpenPlanPreview = (block: PlanBlock, messageId?: string | number) => {
    const sid = sessionId();
    if (!sid || !block.id) return;
    previewStore.registerPlan(sid, {
      blockId: block.id,
      label: 'Plan',
      messageId: messageId == null ? undefined : String(messageId),
    });
    sidePanelStore.openTab('preview');
  };

  const focusComposer = () => {
    queueMicrotask(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.focus());
  };

  const liveBlocks = createMemo((): MessageBlock[] => {
    const live = liveState();
    return live.activityBlocks;
  });

  const liveTools = createMemo(() => liveState().activeTools);
  const queuedPrompts = createMemo(() => composerQueueStore.getQueuedPrompts(sessionId()));
  const firstQueuedPrompt = createMemo(() => queuedPrompts()[0] ?? null);
  const steerFirstQueuedDisabledReason = createMemo(() => {
    const entry = firstQueuedPrompt();
    const text = entry?.text.trim() ?? '';
    if (!entry) return 'No queued follow-up to steer.';
    if (steeringQueuedId()) return 'Steering first queued follow-up...';
    if (!isStreaming()) return 'No active turn to steer.';
    if (connectionState() !== 'connected' || !getGateway()) return 'Gateway is not connected.';
    if (!text) return 'Cannot steer an empty queued follow-up.';
    if (entry.attachments.length > 0 || (entry.displayParts?.length ?? 0) > 0) {
      return 'Queued follow-ups with attachments stay queued for the next turn.';
    }
    if (text.startsWith('/')) return 'Slash commands stay queued for the next turn.';
    return null;
  });
  const canSteerFirstQueued = createMemo(() => steerFirstQueuedDisabledReason() == null);
  createEffect(() => {
    if (queuedPrompts().length === 0) setQueuedSteerWarning(null);
  });

  const blockingPromptActive = createMemo(() =>
    Boolean(liveState().pendingPermission || liveState().pendingClarify || liveState().pendingUserInput)
  );

  // ── Extracted modules ─────────────────────────────────────────────────

  const scroll = createScrollController({
    getMessages: messages,
    getLiveBlocks: liveBlocks,
    getLiveTurnId: () => liveState().turnId,
    getBlockingPromptActive: blockingPromptActive,
  });

  const virtualMessages = createMemo(() =>
    virtualizeMessages(messages(), messageScrollTop(), messageViewportHeight(), {
      defaultToBottom: !messageListMounted() || !scroll.userScrolledUp(),
    })
  );

  const syncMessageListMetrics = () => {
    const el = scroll.refs.messageList;
    if (!el) return;
    setMessageScrollTop(el.scrollTop);
    setMessageViewportHeight(el.clientHeight || MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT);
  };

  createEffect(() => {
    const count = messages().length;
    if (!messageListMounted() || count === 0 || scroll.userScrolledUp()) return;
    const el = scroll.refs.messageList;
    if (!el) return;
    const range = virtualMessages();
    if (!range.virtualized) return;
    const nextTop = Math.max(0, range.totalHeight - messageViewportHeight());
    setMessageScrollTop(nextTop);
    el.scrollTop = nextTop;
  });

  const cards = createCommandCardState();

  onMount(() => {
    if (!messageInputResizeRef || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      scroll.handleViewportResize();
    });
    observer.observe(messageInputResizeRef);
    onCleanup(() => observer.disconnect());
  });

  onMount(() => {
    const updateChatBodyWidth = (width?: number) => {
      const measuredWidth = width ?? chatBodyRef?.getBoundingClientRect().width ?? 0;
      setChatBodyWidth(Math.max(0, Math.round(measuredWidth)));
    };

    updateChatBodyWidth();
    if (!chatBodyRef || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      updateChatBodyWidth(entry?.contentRect.width);
    });
    observer.observe(chatBodyRef);
    onCleanup(() => observer.disconnect());
  });

  const sendPrompt = async (
    promptText: string,
    display?: PromptDisplayMetadata,
    attachments: readonly unknown[] = [],
    displayParts?: UserDisplayPart[],
    extraContext?: string,
  ) => {
    const sid = sessionId();
    const safeAttachments = sanitizeAttachmentChips(attachments);
    const refText = safeAttachments
      .map((attachment) => attachment.refText)
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\n');
    const imageAttachments = safeAttachments.filter((attachment) => attachment.kind === 'image' && attachment.path);
    const attachmentLabelText = safeAttachments.map((attachment) => attachment.name).join(', ');
    const submitText = promptText || (imageAttachments.length > 0 ? 'What do you see in this image?' : attachmentLabelText);
    const displayText = (display?.text ?? promptText) || attachmentLabelText;
    const gateway = getGateway();

    // Persist image attachments into a durable per-session assets dir (the
    // clipboard temp file may be purged by the OS), then carry the persisted
    // paths as image display-parts so they survive a restart via the
    // user_display_parts round-trip. Falls back to the raw path outside Tauri.
    const persistedImages: { path: string; name: string }[] = [];
    if (imageAttachments.length > 0) {
      try {
        for (const attachment of imageAttachments) {
          if (!attachment.path) continue;
          let imagePath = attachment.path;
          if (isTauri()) {
            imagePath = await invoke<string>('persist_session_image', {
              sessionId: sid,
              srcPath: attachment.path,
            });
          }
          persistedImages.push({ path: imagePath, name: attachment.name });
        }
      } catch (error) {
        chatStore.markUserMessageFailed(
          sid,
          crypto.randomUUID(),
          error instanceof Error ? error.message : 'Failed to attach image',
        );
        return false;
      }
    }

    // Merge image display-parts into the parts carried to the store + sidecar.
    const mergedDisplayParts: UserDisplayPart[] = [
      ...(displayParts ?? []),
      ...persistedImages.map((img) => ({ type: 'image' as const, path: img.path, name: img.name })),
    ];

    const messageId = chatStore.appendUserMessage(sid, displayText, display?.slashCommand, submitText, safeAttachments, mergedDisplayParts);
    if (gateway && persistedImages.length > 0) {
      try {
        for (const img of persistedImages) {
          await gateway.image.attach({ session_id: sid, path: img.path });
        }
      } catch (error) {
        chatStore.markUserMessageFailed(
          sid,
          messageId,
          error instanceof Error ? error.message : 'Failed to attach image',
        );
        return false;
      }
    }
    const turnContext = [refText, extraContext]
      .filter((value): value is string => Boolean(value?.trim()))
      .join('\n\n') || undefined;
    const dispatch = resolvePromptDispatch(submitText, displayText, display, turnContext);
    const ok = await chatStore.sendMessage(sid, dispatch.message, {
      context: dispatch.context,
      slashCommand: dispatch.slashCommand,
      displayParts: mergedDisplayParts,
    });
    if (!ok) {
      chatStore.markUserMessageFailed(sid, messageId, chatStore.getError(sid) ?? 'Failed to send message');
    }
    return ok;
  };

  const { handleSlashCommand } = createSlashCommandRunner({
    sessionId,
    getGateway,
    sendPrompt,
    noticeCard: cards.noticeCard,
    navigate,
  });

  const resolveEditedPrompt = async (text: string): Promise<EditedPromptResolution> => {
    const trimmed = text.trim();
    if (!trimmed) return { kind: 'blocked', message: 'Message cannot be empty.' };
    if (!trimmed.startsWith('/')) return { kind: 'prompt', text };

    const gateway = getGateway();
    if (!gateway) return { kind: 'blocked', message: 'Gateway is not connected.' };

    const withoutSlash = trimmed.slice(1).trim();
    const [command = '', ...rest] = withoutSlash.split(/\s+/);
    const args = rest.join(' ');
    if (!command) return { kind: 'blocked', message: 'Slash command is incomplete.' };

    const params = { session_id: sessionId(), command, args, raw: trimmed };
    let result: CommandResult;
    try {
      result = await gateway.slash.resolvePrompt(params);
    } catch (err) {
      return { kind: 'blocked', message: `Command error: ${err instanceof Error ? err.message : String(err)}` };
    }

    return resolveEditedSlashCommandResult(command, args, result);
  };

  const updateInlineEditDraft = (messageId: RenderedMessage['id'], draft: string) => {
    setInlineEdit((current) =>
      current?.messageId === messageId ? { ...current, draft, error: null } : current
    );
  };

  const setInlineEditError = (messageId: RenderedMessage['id'], error: string) => {
    setInlineEdit((current) =>
      current?.messageId === messageId ? { ...current, pending: false, error } : current
    );
  };

  const inlineEditDisabledReason = (message: RenderedMessage): string | null => {
    const current = inlineEdit();
    if (!current || current.messageId !== message.id) return null;
    if (message.deliveryStatus === 'failed') return null;
    if (messageHasImageAttachment(message)) {
      return 'Historical image messages cannot be restored yet. Re-send the image from the composer.';
    }
    if (!message.turnId) {
      return 'This message is still missing its persisted turn id. Try again after the turn starts or reload the session.';
    }
    return null;
  };

  const beginInlineEdit = (message: RenderedMessage) => {
    if (message.role !== 'user') return;
    if (isStreaming()) {
      setInlineEdit({
        messageId: message.id,
        turnId: message.turnId ?? null,
        draft: resolveMessageEditDraft(message),
        pending: false,
        error: 'Finish or stop the current turn before editing history.',
      });
      return;
    }
    setInlineEdit({
      messageId: message.id,
      turnId: message.turnId ?? null,
      draft: resolveMessageEditDraft(message),
      pending: false,
      error: null,
    });
  };

  const confirmInlineEdit = async (message: RenderedMessage) => {
    const current = inlineEdit();
    if (!current || current.messageId !== message.id || current.pending) return;
    const sid = sessionId();
    const gateway = getGateway();
    if (!sid || !gateway) {
      setInlineEditError(message.id, 'Gateway is not connected.');
      return;
    }

    const disabledReason = inlineEditDisabledReason(message);
    if (disabledReason) {
      setInlineEditError(message.id, disabledReason);
      return;
    }

    setInlineEdit({ ...current, pending: true, error: null });
    const resolved = await resolveEditedPrompt(current.draft);
    if (resolved.kind === 'blocked') {
      setInlineEditError(message.id, resolved.message);
      return;
    }
    const shouldPreserveRestoreParts = !current.draft.trim().startsWith('/') && !resolved.display?.slashCommand;
    const restoreDisplayParts = shouldPreserveRestoreParts
      ? resolveMessageRestoreDisplayParts(message, resolved.text)
      : undefined;
    const restoreAttachments = restoreDisplayParts
      ? attachmentsFromDisplayParts(restoreDisplayParts)
      : undefined;

    if (message.deliveryStatus === 'failed') {
      const retryAttachments = restoreAttachments
        ?? (Array.isArray(message.attachments) ? message.attachments as AttachmentChip[] : []);
      const retryDisplayParts = restoreDisplayParts
        ?? (Array.isArray(message.displayParts) ? message.displayParts as UserDisplayPart[] : undefined);
      chatStore.removeMessage(sid, message.id);
      setInlineEdit(null);
      await sendPrompt(resolved.text, resolved.display, retryAttachments, retryDisplayParts);
      return;
    }

    const turnId = message.turnId ?? current.turnId;
    if (!turnId) {
      setInlineEditError(message.id, 'This message is missing its persisted turn id.');
      return;
    }

    try {
      await gateway.session.rewindToTurn(sid, turnId);
      chatStore.removeMessagesFrom(sid, message.id);
      setInlineEdit(null);
      await sendPrompt(resolved.text, resolved.display, restoreAttachments, restoreDisplayParts);
    } catch (err) {
      setInlineEditError(message.id, err instanceof Error ? err.message : 'Failed to restore this message.');
    }
  };

  useGatewayEvents({ getGateway });

  onMount(() => {
    void configStore.loadConfig();
    const syncConnectionState = () => {
      const state = getGateway()?.getConnectionState() ?? uiStore.connectionState;
      setConnectionState(state);
      uiStore.setConnectionState(state);
    };
    syncConnectionState();
    const timer = window.setInterval(syncConnectionState, 1_000);
    onCleanup(() => window.clearInterval(timer));
  });

  createEffect(() => {
    const sid = sessionId();
    setPermissionModeAppliesNextTurn(false);
    sid;
  });

  const handlePermissionModeChange = async (mode: DesktopPermissionMode) => {
    const sid = sessionId();
    if (!sid || permissionModePending()) return;
    setPermissionModePending(true);
    try {
      const updated = await sessionStore.setPermissionMode(sid, mode);
      if (!updated) {
        cards.noticeCard('Could not update permission mode.');
        return;
      }
      const appliesNextTurn = Boolean((updated as typeof updated & { appliesNextTurn?: boolean }).appliesNextTurn);
      setPermissionModeAppliesNextTurn(appliesNextTurn);
      if (appliesNextTurn) {
        cards.noticeCard('Permission mode will apply next turn.');
      }
    } finally {
      setPermissionModePending(false);
    }
  };

  const setCollaborationMode = async (nextMode: CollaborationMode, failureMessage = 'Could not update collaboration mode.') => {
    const sid = sessionId();
    if (!sid) return false;
    if (collaborationMode() === nextMode) return true;
    if (collaborationModePending()) return false;
    setCollaborationModePending(true);
    try {
      const updated = await sessionStore.updateRuntime(sid, { collaborationMode: nextMode });
      if (!updated) {
        cards.noticeCard(failureMessage);
        return false;
      }
      return true;
    } finally {
      setCollaborationModePending(false);
    }
  };

  const handleCollaborationModeToggle = async () => {
    const nextMode: CollaborationMode = collaborationMode() === 'plan' ? 'default' : 'plan';
    await setCollaborationMode(nextMode);
  };

  const isCurrentActionablePlan = (block: PlanBlock, messageId?: string | number) => {
    const key = actionablePlanKey();
    return Boolean(
      key &&
      messageId != null &&
      String(key.messageId) === String(messageId) &&
      key.blockId === block.id
    );
  };

  const handleExecutePlan = async (block: PlanBlock, messageId?: string | number) => {
    if (block.isStreaming) return;
    if (isStreaming()) {
      cards.noticeCard('Wait for the current turn to finish.');
      return;
    }
    if (!isCurrentActionablePlan(block, messageId)) {
      cards.noticeCard('This plan has been superseded.');
      return;
    }
    const switched = await setCollaborationMode('default', 'Could not switch out of Plan mode.');
    if (!switched) return;
    await sendPrompt(
      EXECUTE_PLAN_MESSAGE,
      { text: EXECUTE_PLAN_MESSAGE },
      [],
      undefined,
      buildPlanExecutionContext(block.content),
    );
  };

  const handleRejectPlan = async (block: PlanBlock, messageId?: string | number) => {
    if (block.isStreaming) return;
    if (!isCurrentActionablePlan(block, messageId)) {
      cards.noticeCard('This plan has been superseded.');
      return;
    }
    const readyForFeedback = await setCollaborationMode('plan', 'Could not keep Plan mode.');
    if (readyForFeedback) focusComposer();
  };

  createEffect(() => {
    const sid = sessionId();
    const busy = isStreaming();
    const queueLength = composerQueueStore.getQueuedPrompts(sid).length;
    const shouldDrain = shouldAutoDrainOnSettle({
      wasBusy,
      isBusy: busy,
      queueLength,
      userInterrupted: suppressNextAutoDrain,
    });

    if (shouldDrain) {
      const next = composerQueueStore.dequeue(sid);
      if (next) {
        const queuedText = next.text.trim();
        if (!next.attachments.length && queuedText.startsWith('/')) {
          void handleSlashCommand(queuedText);
        } else {
          void sendPrompt(next.text, undefined, next.attachments as AttachmentChip[], next.displayParts as UserDisplayPart[] | undefined);
        }
      }
    }

    if (wasBusy && !busy) {
      suppressNextAutoDrain = false;
    }
    wasBusy = busy;
  });

  createEffect(() => {
    const config = voiceConfig();
    if (!isAutoTtsEnabled(config) || !isTtsAvailable(config) || isStreaming()) return;
    const lastAssistant = [...messages()].reverse().find((message) => message.role === 'assistant' && !message.isStreaming);
    if (!lastAssistant) return;
    const messageId = String(lastAssistant.id);
    if (autoTtsPlayed.has(messageId)) return;
    const text = lastAssistant.blocks
      .filter((block): block is TextBlock => block.type === 'text')
      .map((block) => block.content)
      .join('\n')
      .trim();
    if (!text) return;
    autoTtsPlayed.add(messageId);
    void playSpeechText(text, { source: 'auto-tts', messageId });
  });

  // ── Floating TodoPanel state ──────────────────────────────────────────

  // Dismissed state is persisted per session (localStorage via uiStore) so the panel
  // restores to its pre-close visibility on restart — a completed-and-hidden panel
  // stays hidden, an unfinished one re-appears. A new turn clears it (see effect below).
  const panelManuallyClosed = () => uiStore.isTodoPanelDismissed(sessionId());
  const setPanelManuallyClosed = (closed: boolean) => {
    if (closed) uiStore.dismissTodoPanel(sessionId());
    else uiStore.restoreTodoPanel(sessionId());
  };
  const [panelExiting, setPanelExiting] = createSignal(false);
  const [isPaused, setIsPaused] = createSignal(false);
  const [showUndoBar, setShowUndoBar] = createSignal(false);
  const [incompleteCount, setIncompleteCount] = createSignal(0);
  let autoCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let undoBarTimer: ReturnType<typeof setTimeout> | undefined;

  const hasActiveTodoTool = createMemo(() =>
    liveTools().some((t) => t.name === 'todo' && t.status === 'running')
  );

  const panelTodos = createMemo((): TodoItem[] => {
    const live = liveState();
    if (isStreaming() && live.todos.length > 0) return live.todos;
    const msgs = messages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role !== 'assistant') continue;
      const todoBlock = m.blocks.find((b): b is TodoListBlock => b.type === 'todo_list');
      if (todoBlock) return todoBlock.todos;
      break;
    }
    return [];
  });

  const allTodosComplete = createMemo(() => {
    const todos = panelTodos();
    return todos.length > 0 && todos.every((t) => t.status === 'completed' || t.status === 'cancelled');
  });

  const showFloatingPanel = createMemo(() => {
    if (panelManuallyClosed()) return false;
    if (hasActiveTodoTool()) return true;
    // Live todos in the current streaming turn — includes the brief all-complete
    // "done" moment, which the 2s auto-close below then dismisses.
    if (isStreaming() && liveState().todos.length > 0) return true;
    // Historical fallback (last assistant message's todo_list): only surface it when
    // there is still unfinished work. A fully-completed list must NOT re-appear on
    // later conversation turns, even though the reset effect clears the dismissed flag.
    const todos = panelTodos();
    return todos.length > 0 && todos.some((t) => t.status !== 'completed' && t.status !== 'cancelled');
  });

  createEffect(() => {
    clearTimeout(autoCloseTimer);
    if (allTodosComplete() && showFloatingPanel() && !isPaused()) {
      autoCloseTimer = setTimeout(() => { doClosePanel(); }, 2000);
    }
  });

  createEffect(() => {
    if (isStreaming() && !hasActiveTodoTool() && liveState().todos.length === 0) {
      setPanelManuallyClosed(false);
      setIsPaused(false);
      setShowUndoBar(false);
    }
  });

  const doClosePanel = () => {
    setPanelExiting(true);
    setTimeout(() => {
      setPanelManuallyClosed(true);
      setPanelExiting(false);
      setShowUndoBar(false);
    }, 150);
  };

  const handleTodoPanelClose = () => {
    const todos = panelTodos();
    const incomplete = todos.filter((t) => t.status === 'pending' || t.status === 'in_progress');
    const hasIncomplete = incomplete.length > 0;
    if (hasIncomplete && isStreaming()) {
      void chatStore.cancelMessage(sessionId());
      setIsPaused(true);
    }
    if (hasIncomplete) {
      setIncompleteCount(incomplete.length);
      setShowUndoBar(true);
      undoBarTimer = setTimeout(() => {
        setShowUndoBar(false);
        doClosePanel();
      }, 5000);
    } else {
      doClosePanel();
    }
  };

  const handleUndoClose = () => {
    clearTimeout(undoBarTimer);
    setShowUndoBar(false);
    setPanelManuallyClosed(false);
    setIsPaused(false);
  };

  const handleTodoPanelPause = () => {
    if (isPaused()) {
      setIsPaused(false);
    } else {
      void chatStore.cancelMessage(sessionId());
      setIsPaused(true);
    }
  };

  const stopCurrentTurn = () => {
    const sid = sessionId();
    if (!sid || !isStreaming()) return false;
    suppressNextAutoDrain = true;
    void chatStore.cancelMessage(sid);
    return true;
  };

  const dismissActiveChatPanel = () => {
    const sid = sessionId();
    if (!sid) return false;
    const live = liveState();
    if (live.pendingUserInput) {
      void chatStore.respondUserInput(
        sid,
        live.pendingUserInput.requestId,
        emptyUserInputAnswers(live.pendingUserInput.questions),
      );
      return true;
    }
    if (live.pendingPermission) {
      handlePermissionCancel();
      return true;
    }
    if (live.pendingClarify) {
      void chatStore.respondClarify(sid, live.pendingClarify.requestId, '');
      return true;
    }
    if (cards.commandCard()) {
      cards.dismissCommandCard();
      return true;
    }
    if (showFloatingPanel() || panelExiting()) {
      handleTodoPanelClose();
      return true;
    }
    return false;
  };

  const hasPriorityEscapeSurface = (event: KeyboardEvent) =>
    escapePrioritySurfaceAtKeydown ||
    eventPathHasPrioritySurface(event) ||
    Boolean(document.querySelector(ESCAPE_PRIORITY_SURFACE_SELECTOR));

  const isChatEscapeTarget = (event: KeyboardEvent) => {
    if (!rootRef) return true;
    const target = event.target;
    if (
      target instanceof Node &&
      target !== document &&
      target !== document.body &&
      !rootRef.contains(target)
    ) {
      return false;
    }

    const active = document.activeElement;
    return !(
      active instanceof Node &&
      active !== document.body &&
      active !== document.documentElement &&
      !rootRef.contains(active)
    );
  };

  const handleChatEscapeCapture = (event: KeyboardEvent) => {
    if (!isPlainEscape(event)) {
      escapePrioritySurfaceAtKeydown = false;
      return;
    }
    escapePrioritySurfaceAtKeydown =
      eventPathHasPrioritySurface(event) ||
      Boolean(document.querySelector(ESCAPE_PRIORITY_SURFACE_SELECTOR));
  };

  const handleChatEscape = (event: KeyboardEvent) => {
    if (!isPlainEscape(event)) return;
    const prioritySurfaceOpen = hasPriorityEscapeSurface(event);
    escapePrioritySurfaceAtKeydown = false;
    if (event.defaultPrevented || prioritySurfaceOpen || !isChatEscapeTarget(event)) return;

    if (dismissActiveChatPanel() || stopCurrentTurn()) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  onMount(() => {
    window.addEventListener('keydown', handleChatEscapeCapture, true);
    window.addEventListener('keydown', handleChatEscape);
    onCleanup(() => {
      window.removeEventListener('keydown', handleChatEscapeCapture, true);
      window.removeEventListener('keydown', handleChatEscape);
    });
  });

  // ── Date separators ───────────────────────────────────────────────────

  function computeDateSeparators(msgs: RenderedMessage[]): Map<number, string> {
    const separators = new Map<number, string>();
    let lastDay: string | null = null;
    for (let i = 0; i < msgs.length; i++) {
      const ts = msgs[i].timestamp;
      if (ts == null) continue;
      const day = new Date(ts * 1000).toDateString();
      if (day !== lastDay) {
        separators.set(i, formatDateLabel(ts));
        lastDay = day;
      }
    }
    return separators;
  }

  function formatDateLabel(ts: number): string {
    const date = new Date(ts * 1000);
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Today';
    if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  }

  const dateSeparators = createMemo(() => computeDateSeparators(messages()));

  // ── Session loading & model sync ──────────────────────────────────────

  createEffect(() => {
    const sid = sessionId();
    if (!sid) return;
    sessionStore.setActiveSession(sid);
    setInlineEdit(null);
    untrack(async () => {
      await chatStore.loadMessages(sid);
      const exists = sessionStore.sessions.some((s) => s.id === sid);
      if (!exists) {
        const remaining = sessionStore.sessions;
        if (remaining.length > 0) {
          navigate(`/conversation/${remaining[0].id}`);
        } else {
          try {
            const meta = await sessionStore.createSession({});
            if (meta) navigate(`/conversation/${meta.id}`);
          } catch {
            // silently ignore
          }
        }
      }
    });
    scroll.resetScrollState();
  });

  // Seed sessionModels from session metadata if not already set by a user switch.
  // Does NOT touch modelStore.defaultModel — per-session and global are separate.
  createEffect(() => {
    const sid = sessionStore.activeSessionId;
    if (!sid) return;
    if (sessionStore.getSessionModel(sid)) return; // already set
    const session = sessionStore.activeSession;
    if (session?.provider && session?.model) {
      sessionStore.setSessionModel(sid, session.provider, session.model);
    }
  });

  createEffect(() => {
    const sid = sessionId();
    const path = cwd();
    gitViewStore.setWorkspace(sid, path);
    void workspaceTreeStore.setWorkspace(sid, path);
    if (path && sidePanelStore.isOpen() && sidePanelStore.activeView() === 'review') {
      void gitViewStore.fetchReview();
    }
  });

  createEffect(() => {
    if (sidePanelStore.isOpen() && sidePanelStore.activeView() === 'review' && cwd()) {
      void gitViewStore.fetchReview();
    }
  });

  // ── Message action handler ────────────────────────────────────────────

  const handleMessageAction = async (sid: string, action: MessageActionType, message: RenderedMessage) => {
    switch (action) {
      case 'copy': {
        await navigator.clipboard.writeText(resolveMessageCopyText(message));
        break;
      }
      case 'edit': {
        beginInlineEdit(message);
        break;
      }
      case 'retry': {
        if (isStreaming()) break;
        if (message.role === 'user' && message.deliveryStatus === 'failed') {
          const retryText = message.submitText
            ?? message.blocks.filter((b) => b.type === 'text').map((b) => (b as TextBlock).content).join('\n');
          const displayText = message.blocks.filter((b) => b.type === 'text').map((b) => (b as TextBlock).content).join('\n');
          const retryAttachments = Array.isArray(message.attachments) ? message.attachments as AttachmentChip[] : [];
          chatStore.removeMessage(sid, message.id);
          await sendPrompt(
            retryAttachments.length > 0 ? displayText : retryText,
            message.slashCommand ? { text: displayText, slashCommand: message.slashCommand } : { text: displayText },
            retryAttachments,
          );
          break;
        }
        const gateway = getGateway();
        if (!gateway) break;
        const lastUserText = chatStore.removeLastTurn(sid);
        if (!lastUserText) break;
        try { await gateway.session.undo(sid); } catch { /* proceed anyway */ }
        await sendPrompt(lastUserText);
        break;
      }
      case 'branch': {
        const meta = await sessionStore.branchSession(sid);
        if (meta) navigate(`/conversation/${meta.id}`);
        break;
      }
      case 'undo': {
        if (isStreaming()) break;
        const gateway = getGateway();
        if (!gateway) break;
        chatStore.removeLastTurn(sid);
        try { await gateway.session.undo(sid); } catch { /* UI already updated */ }
        break;
      }
    }
  };

  // ── Handlers ──────────────────────────────────────────────────────────

  const handleSend = async (text: string, attachments?: QueuedAttachment[], displayParts?: UserDisplayPart[]) => {
    const trimmed = text.trim();
    if (isStreaming()) {
      composerQueueStore.enqueue(sessionId(), { text: trimmed || text, attachments, displayParts });
      setQueuedSteerWarning(null);
      return;
    }
    if (!attachments?.length && trimmed.startsWith('/')) {
      await handleSlashCommand(trimmed);
      return true;
    }
    cards.setCommandCard(null);
    return sendPrompt(text, undefined, attachments as AttachmentChip[] | undefined, displayParts);
  };

  createEffect(() => {
    const next = composerInsertionStore.latestSubmission();
    if (!next || next.id === lastComposerSubmissionId) return;
    const currentSession = sessionId().trim() || null;
    if (next.sessionId && next.sessionId !== currentSession) return;
    lastComposerSubmissionId = next.id;
    void handleSend(next.text, next.attachments as QueuedAttachment[] | undefined);
  });

  const handleMaskedPermissionSubmit = (requestId: string, value: string) => {
    const permission = liveState().pendingPermission;
    if (!permission) return;
    if (permission.kind === 'sudo') {
      void chatStore.respondSudo(sessionId(), requestId, value);
    } else if (permission.kind === 'secret') {
      void chatStore.respondSecret(sessionId(), requestId, value);
    }
  };

  const handlePermissionCancel = () => {
    const permission = liveState().pendingPermission;
    if (!permission) return;
    if (permission.kind === 'approval') {
      void chatStore.respondApproval(sessionId(), 'deny');
    } else if (permission.kind === 'sudo' && permission.requestId) {
      void chatStore.respondSudo(sessionId(), permission.requestId, '');
    } else if (permission.kind === 'secret' && permission.requestId) {
      void chatStore.respondSecret(sessionId(), permission.requestId, '');
    }
  };

  const handleRemoveQueuedPrompt = (id: string) => {
    composerQueueStore.remove(sessionId(), id);
  };

  const handleEditQueuedPrompt = (id: string) => {
    const entry = composerQueueStore.remove(sessionId(), id);
    if (!entry) return;
    setEditQueuedPayload({
      text: entry.text,
      attachments: sanitizeAttachmentChips(entry.attachments),
      displayParts: entry.displayParts?.map((part) => ({ ...part })),
    });
    setQueuedSteerWarning(null);
  };

  const handleSendQueuedPromptNow = (id: string) => {
    if (isStreaming()) {
      setQueuedSteerWarning('Queued follow-ups can be sent now after the current turn finishes.');
      return;
    }
    const entry = composerQueueStore.remove(sessionId(), id);
    if (!entry) return;
    setQueuedSteerWarning(null);
    void sendPrompt(entry.text, undefined, entry.attachments as AttachmentChip[], entry.displayParts as UserDisplayPart[] | undefined);
  };

  const handleSteerFirstQueuedPrompt = async () => {
    const entry = firstQueuedPrompt();
    const sid = sessionId();
    const text = entry?.text.trim() ?? '';
    const gateway = getGateway();
    if (!entry || !sid || !gateway || steerFirstQueuedDisabledReason()) {
      setQueuedSteerWarning(STEER_UNAVAILABLE_WARNING);
      return;
    }

    setSteeringQueuedId(entry.id);
    try {
      const result = await gateway.session.steer(sid, text);
      if (result?.status === 'queued') {
        setQueuedSteerWarning(null);
        composerQueueStore.remove(sid, entry.id);
        return;
      }
      setQueuedSteerWarning(STEER_UNAVAILABLE_WARNING);
    } catch {
      setQueuedSteerWarning(STEER_UNAVAILABLE_WARNING);
    } finally {
      if (steeringQueuedId() === entry.id) setSteeringQueuedId(null);
    }
  };

  // ── Prompt dock items ─────────────────────────────────────────────────

  const promptDockItems = createMemo<PromptDockItem[]>(() => {
    const items: PromptDockItem[] = [];
    const live = liveState();
    const userInput = live.pendingUserInput;
    const permission = live.pendingPermission;
    const clarify = live.pendingClarify;
    const queued = queuedPrompts();

    if (userInput) {
      items.push({
        id: `user-input-${userInput.requestId}`,
        content: (
          <UserInputRequestCard
            questions={userInput.questions}
            onSubmit={(answers) => void chatStore.respondUserInput(sessionId(), userInput.requestId, answers)}
          />
        ),
      });
    }

    if (permission) {
      items.push({
        id: `permission-${permission.kind}-${permission.requestId ?? permission.command}`,
        content: (
          <PermissionRequestCard
            permission={permission}
            onApprovalChoice={(choice) => void chatStore.respondApproval(sessionId(), choice)}
            onMaskedSubmit={handleMaskedPermissionSubmit}
            onCancel={handlePermissionCancel}
          />
        ),
      });
    }

    if (clarify) {
      items.push({
        id: `clarify-${clarify.requestId}`,
        content: (
          <ClarificationCard
            question={clarify.question}
            choices={clarify.choices}
            onRespond={(text) => void chatStore.respondClarify(sessionId(), clarify.requestId, text)}
          />
        ),
      });
    }

    if (!userInput && !permission && !clarify && (showFloatingPanel() || panelExiting())) {
      items.push({
        id: 'todo-panel',
        placement: 'compact-center',
        content: (
          <>
            <TodoPanel
              todos={panelTodos()}
              isStreaming={isStreaming()}
              isPaused={isPaused()}
              floating
              exiting={panelExiting()}
              onClose={handleTodoPanelClose}
              onPause={handleTodoPanelPause}
            />
            <Show when={showUndoBar()}>
              <div class={styles.undoBar}>
                <span>Chat paused · {incompleteCount()} task{incompleteCount() !== 1 ? 's' : ''} incomplete</span>
                <button class={styles.undoBtn} onClick={handleUndoClose}>Undo</button>
              </div>
            </Show>
          </>
        ),
      });
    }

    if (!permission && !clarify && cards.commandCard()) {
      items.push({
        id: 'command-card',
        content: <CommandCardDock card={cards.commandCard()!} embedded onDismiss={cards.dismissCommandCard} />,
      });
    }

    const backgroundTasks = recentBackgroundTasks().slice(0, 3);
    if (!permission && !clarify && backgroundTasks.length > 0) {
      items.push({
        id: 'background-tasks',
        content: (
          <BackgroundTaskDock
            tasks={backgroundTasks}
            onDismiss={(id) => backgroundTaskStore.dismiss(id)}
          />
        ),
      });
    }

    if (!userInput && !permission && !clarify && queued.length > 0) {
      items.push({
        id: 'queued-prompts',
        content: (
          <QueuedPromptDock
            entries={queued}
            onRemove={handleRemoveQueuedPrompt}
            canSteerFirst={canSteerFirstQueued()}
            steerDisabledReason={steerFirstQueuedDisabledReason() ?? undefined}
            warning={queuedSteerWarning()}
            onSteerFirst={() => void handleSteerFirstQueuedPrompt()}
            onEdit={handleEditQueuedPrompt}
            onSendNow={handleSendQueuedPromptNow}
          />
        ),
      });
    }

    return items;
  });

  // ── Render ────────────────────────────────────────────────────────────

  return (
    <div class={styles.chatView} ref={(el) => { rootRef = el; }}>
      <Show when={error()}>
        <ErrorBanner
          message={error()!}
          action={errorAction()}
          onRetry={() => handleSend('')}
          onDismiss={() => { chatStore.clearError(sessionId()); }}
        />
      </Show>

      <Show when={!sessionStore.getSessionModel(sessionId()) && !modelStore.defaultModel}>
        <div class={styles.noModelBanner}>
          <Icon name="alert-triangle" size={16} class={styles.noModelIcon} />
          <span class={styles.noModelText}>
            No model provider configured — messages cannot be sent until you add one.
          </span>
          <button type="button" class={styles.noModelBtn} onClick={() => navigate(ROUTES.SETTINGS_MODEL)}>
            Configure
          </button>
        </div>
      </Show>

      <Show when={liveState().memoryContext}>
        <MemoryContextCard items={liveState().memoryContext!} onEdit={() => {}} />
      </Show>

      <div
        ref={(el) => { chatBodyRef = el; }}
        class={styles.chatBody}
        data-testid="chat-body"
      >
        <div class={styles.chatPane}>
          <Switch>
            <Match when={isLoading()}>
              <div class={styles.loadingState}>
                <div class={styles.loadingRow}>
                  <Icon name="loader" size={20} class={styles.loadingIcon} />
                  <span class={styles.loadingLabel}>Loading messages...</span>
                </div>
              </div>
            </Match>
            <Match when={isEmpty()}>
              <div
                class={styles.emptyState}
                classList={{ [styles.emptyStateWithEnvironment]: environmentPanelVisible() }}
                data-testid="chat-empty-state"
              >
                <div class={styles.emptyStateColumn}>
                  <EmptyChatState onSuggestionClick={(idx) => {
                    const suggestions = ['Debug my code', 'Review my PR', 'Plan a feature'];
                    handleSend(suggestions[idx] ?? '');
                  }} />
                </div>
              </div>
            </Match>
            <Match when={true}>
              <div
                ref={(el) => {
                  scroll.refs.messageList = el;
                  setMessageListMounted(true);
                  setMessageViewportHeight(el.clientHeight || MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT);
                }}
                class={styles.messageList}
                classList={{ [styles.messageListWithEnvironment]: environmentPanelVisible() }}
                data-testid="chat-message-list"
                onScroll={() => {
                  syncMessageListMetrics();
                  scroll.handleScroll();
                }}
                style={{ "padding-bottom": blockingPromptActive() ? '60px' : undefined }}
              >
                <div class={styles.messageColumn}>
                  <Show when={virtualMessages().beforeHeight > 0}>
                    <div
                      aria-hidden="true"
                      data-testid="message-virtual-spacer-before"
                      style={{ height: `${virtualMessages().beforeHeight}px` }}
                    />
                  </Show>
                  <For each={virtualMessages().messages}>
                    {(message, getIndex) => {
                      const idx = virtualMessages().startIndex + getIndex();
                      const onAction = (action: MessageActionType) =>
                        void handleMessageAction(sessionId(), action, message);
                      const editState = () => inlineEdit()?.messageId === message.id ? inlineEdit() : null;
                      const actionablePlanBlockId = () => {
                        const key = actionablePlanKey();
                        return key && String(key.messageId) === String(message.id) ? key.blockId : null;
                      };
                      return (
                        <div style={{ "min-height": `${MESSAGE_VIRTUAL_ROW_HEIGHT}px` }}>
                          <MessageBubble
                            message={message}
                            showDateSeparator={dateSeparators().has(idx)}
                            dateSeparatorLabel={dateSeparators().get(idx)}
                            onAction={onAction}
                            isLast={idx === messages().length - 1}
                            actionsDisabled={isStreaming()}
                            isEditing={!!editState()}
                            editDraft={editState()?.draft}
                            editPending={!!editState()?.pending}
                            editError={editState()?.error ?? null}
                            editDisabledReason={inlineEditDisabledReason(message)}
                            onEditDraftChange={(value) => updateInlineEditDraft(message.id, value)}
                            onEditCancel={() => setInlineEdit(null)}
                            onEditConfirm={() => void confirmInlineEdit(message)}
                            turnBoundary={isUserTurnBoundary(messages(), idx, dateSeparators().has(idx))}
                            onOpenPlanPreview={handleOpenPlanPreview}
                            onExecutePlan={handleExecutePlan}
                            onRejectPlan={handleRejectPlan}
                            actionablePlanBlockId={actionablePlanBlockId()}
                            planDecisionPending={collaborationModePending() || isStreaming()}
                          />
                        </div>
                      );
                    }}
                  </For>
                  <Show when={virtualMessages().afterHeight > 0}>
                    <div
                      aria-hidden="true"
                      data-testid="message-virtual-spacer-after"
                      style={{ height: `${virtualMessages().afterHeight}px` }}
                    />
                  </Show>
                  <Show when={liveBlocks().length > 0 || liveTools().length > 0}>
                    <AssistantMessage
                      blocks={liveBlocks()}
                      isStreaming={true}
                      onOpenPlanPreview={handleOpenPlanPreview}
                      onExecutePlan={handleExecutePlan}
                      onRejectPlan={handleRejectPlan}
                      actionablePlanBlockId={null}
                      planDecisionPending={collaborationModePending() || isStreaming()}
                    />
                  </Show>
                  <div ref={scroll.refs.messagesEnd} />
                </div>
              </div>
            </Match>
          </Switch>

          <div
            class={styles.inputArea}
            classList={{ [styles.inputAreaWithEnvironment]: environmentPanelVisible() }}
            data-testid="chat-input-area"
          >
            <div class={styles.inputColumn}>
              <JumpToBottom
                avoidDock={showFloatingPanel() || panelExiting()}
                unreadCount={scroll.unreadCount()}
                visible={!scroll.isNearBottom() && messages().length > 0}
                onClick={() => {
                  scroll.setUserScrolledUp(false);
                  scroll.setUnreadCount(() => 0);
                  scroll.scrollToBottom({ force: true, behavior: 'smooth' });
                }}
              />
              <ConversationRecoveryBanner
                turnState={liveState().status}
                connectionState={connectionState()}
                diagnostics={{
                  lastEventAt: diagnostics().lastEventAt,
                  droppedLateEvents: diagnostics().droppedLateEvents,
                }}
              />
              <PromptDock items={promptDockItems()} />

              <div ref={(el) => { messageInputResizeRef = el; }}>
                <MessageInput
                  sessionId={sessionId()}
                  onSend={handleSend}
                  onStop={() => { stopCurrentTurn(); }}
                  disabled={blockingPromptActive() || !modelStore.activeModel}
                  isStreaming={isStreaming()}
                  modelSlot={(dimmed, disabled, compact) => (
                    <ModelSelector
                      sessionId={sessionId()}
                      dimmed={dimmed}
                      disabled={disabled}
                      compact={compact}
                    />
                  )}
                  cwd={cwd()}
                  historyMessages={messages()}
                  onComposerActivity={scroll.handleViewportResize}
                  permissionMode={permissionMode()}
                  permissionModePending={permissionModePending()}
                  permissionModeAppliesNextTurn={permissionModeAppliesNextTurn()}
                  onPermissionModeChange={handlePermissionModeChange}
                  collaborationMode={collaborationMode()}
                  onCollaborationModeToggle={handleCollaborationModeToggle}
                  isNewConversation={canEditWorkspace()}
                  onCwdChange={(path) => {
                    const sid = sessionId();
                    if (sid) sessionStore.applyCwd(sid, path);
                  }}
                  editDraft={editDraft}
                  clearEditDraft={() => setEditDraft(null)}
                  editPayload={editQueuedPayload}
                  clearEditPayload={() => setEditQueuedPayload(null)}
                  contextUsage={sessionUsage.get(sessionId())}
                  sttEnabled={sttEnabled()}
                  maxVoiceRecordingSeconds={maxVoiceRecordingSeconds()}
                />
              </div>
            </div>
          </div>
        </div>

        <ChatEnvironmentOverlay
          visible={environmentPanelVisible()}
          sessionId={sessionId()}
          workspacePath={cwd()}
        />
      </div>
    </div>
  );
};
