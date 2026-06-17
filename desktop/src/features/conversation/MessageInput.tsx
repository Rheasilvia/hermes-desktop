import type { Accessor, Component } from 'solid-js';
import { createSignal, createEffect, Show, createMemo, untrack, For, onCleanup, onMount } from 'solid-js';
import { fileChipQueue } from '@/stores/file-chip-queue.js';
import {
  clearComposerDraft,
  getComposerDraft,
  saveComposerDraft,
  type ComposerCommandPrefix,
} from '@/stores/composer-drafts.js';
import { open } from '@tauri-apps/plugin-dialog';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Icon, type IconName } from '@/ui/atoms/Icon';
import { WorkspacePicker } from './WorkspacePicker';
import { GitBranchPicker } from './GitBranchPicker';
import { SlashCommandPanel, type SlashCommand } from './SlashCommandPanel';
import { ContextUsageBar, type ContextUsageProps } from './ContextUsageBar';
import { PermissionModePicker } from './PermissionModePicker';
import { AttachmentChips, type AttachmentChip } from './composer/AttachmentChips.js';
import { CompletionPanel, type CompletionItem } from './composer/CompletionPanel.js';
import { getGateway } from '@/stores/context.js';
import { filterDesktopSlashCommands } from './slashCommandCuration.js';
import type { CompletionEntry } from '@/services/gateway/types.js';
import type { DesktopPermissionMode } from '@/types/index.js';
import {
  attachmentsFromDisplayParts,
  compactDisplayParts,
  fileRefLabel,
  llmMessageFromDisplayParts,
  normalizeDisplayPartAnchors,
  parseFileRefDetail,
  parseFileRefLineRange,
  type UserDisplayPart,
  type UserFileRefDisplayPart,
} from './display-parts.js';
import type { RenderedMessage } from '@/types/ui/message.js';
import { createVoiceRecorder } from '@/lib/voice/create-voice-recorder.js';
import { VoiceActivity, VoicePlaybackActivity } from './composer/VoiceActivity.js';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  sessionId?: string | null;
  onSend: (text: string, attachments?: AttachmentChip[], displayParts?: UserDisplayPart[]) => boolean | Promise<boolean | void> | void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  modelSlot?: (dimmed: boolean, disabled: boolean, compact: boolean) => any;
  cwd?: string | null;
  isNewConversation?: boolean;
  onCwdChange?: (path: string) => void;
  editDraft?: Accessor<string | null>;
  clearEditDraft?: () => void;
  contextUsage?: ContextUsageProps;
  historyMessages?: readonly RenderedMessage[];
  onComposerActivity?: () => void;
  permissionMode?: DesktopPermissionMode;
  permissionModePending?: boolean;
  permissionModeAppliesNextTurn?: boolean;
  onPermissionModeChange?: (mode: DesktopPermissionMode) => void;
  /** For voice conversation mode — accessor returning the current streaming assistant text + pending flag. */
  pendingVoiceResponse?: () => { id: string; pending: boolean; text: string } | null;
  consumePendingVoiceResponse?: () => void;
  maxVoiceRecordingSeconds?: number;
  sttEnabled?: boolean;
}

type ReferenceKind = 'file' | 'folder' | 'image' | 'url' | 'tool' | 'git' | 'diff' | 'staged';
type ReferenceCompletionType = 'starter' | 'pathRef' | 'contextRef';

interface ReferenceCompletion {
  kind: ReferenceKind;
  refText: string;
  description: string;
  display: string;
  type: ReferenceCompletionType;
  path?: string;
}

interface ComposerHistoryEntry {
  text: string;
  commandPrefix: ComposerCommandPrefix | null;
  attachments: AttachmentChip[];
  displayParts: UserDisplayPart[];
}

const REFERENCE_STARTERS: ReferenceCompletion[] = [
  { kind: 'file', refText: '@file:', display: '@file:', description: 'Attach a file reference', type: 'starter' },
  { kind: 'folder', refText: '@folder:', display: '@folder:', description: 'Attach a folder reference', type: 'starter' },
  { kind: 'url', refText: '@url:', display: '@url:', description: 'Attach a URL reference', type: 'starter' },
  { kind: 'image', refText: '@image:', display: '@image:', description: 'Attach an image reference', type: 'starter' },
  { kind: 'tool', refText: '@tool:', display: '@tool:', description: 'Attach tool context', type: 'starter' },
  { kind: 'git', refText: '@git:', display: '@git:', description: 'Attach git context', type: 'starter' },
];

const REF_PREFIX_RE = /^@(file|folder|image|url|tool|git):(.*)$/;
const SIMPLE_REF_RE = /^@(diff|staged)$/;
const VOICE_ERROR_DISMISS_MS = 3000;
const COMPACT_COMPOSER_WIDTH = 560;

export const MessageInput: Component<MessageInputProps> = (props) => {
  const [text, setText] = createSignal('');
  const [displayParts, setDisplayParts] = createSignal<UserDisplayPart[]>([]);
  const [focused, setFocused] = createSignal(false);
  const [attachments, setAttachments] = createSignal<AttachmentChip[]>([]);
  const [commandPrefix, setCommandPrefix] = createSignal<ComposerCommandPrefix | null>(null);
  const [attachMenuOpen, setAttachMenuOpen] = createSignal(false);
  const [slashCommands, setSlashCommands] = createSignal<SlashCommand[]>([]);
  const [slashPanelOpen, setSlashPanelOpen] = createSignal(false);
  const [manuallyClosed, setManuallyClosed] = createSignal(false);
  const [referenceItems, setReferenceItems] = createSignal<ReferenceCompletion[]>([]);
  const [referencePanelOpen, setReferencePanelOpen] = createSignal(false);
  const [referenceManuallyClosed, setReferenceManuallyClosed] = createSignal(false);
  const [voiceError, setVoiceError] = createSignal('');
  const [composerWidth, setComposerWidth] = createSignal(0);
  let wrapperRef: HTMLDivElement | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;
  let previousSessionId: string | null | undefined;
  let voiceErrorTimer: ReturnType<typeof setTimeout> | undefined;

  const clearVoiceErrorTimer = () => {
    if (!voiceErrorTimer) return;
    clearTimeout(voiceErrorTimer);
    voiceErrorTimer = undefined;
  };

  const clearVoiceError = () => {
    clearVoiceErrorTimer();
    setVoiceError('');
  };

  const showVoiceError = (message: string) => {
    clearVoiceErrorTimer();
    setVoiceError(message);
    voiceErrorTimer = setTimeout(() => {
      setVoiceError('');
      voiceErrorTimer = undefined;
    }, VOICE_ERROR_DISMISS_MS);
  };

  const insertTranscriptAtCaret = (transcript: string) => {
    const nextTranscript = transcript.trim();
    if (!nextTranscript) return;

    const current = text();
    const selectionStart = textareaRef?.selectionStart ?? current.length;
    const selectionEnd = textareaRef?.selectionEnd ?? selectionStart;
    const start = Math.max(0, Math.min(selectionStart, current.length));
    const end = Math.max(start, Math.min(selectionEnd, current.length));
    const before = current.slice(0, start);
    const after = current.slice(end);
    const needsLeadingSpace = before.length > 0 && !/\s$/.test(before);
    const needsTrailingSpace = after.length > 0 && !/^\s/.test(after);
    const inserted = `${needsLeadingSpace ? ' ' : ''}${nextTranscript}${needsTrailingSpace ? ' ' : ''}`;
    const nextText = `${before}${inserted}${after}`;
    const caret = before.length + inserted.length - (needsTrailingSpace ? 1 : 0);

    setText(nextText);
    queueMicrotask(() => {
      textareaRef?.focus();
      textareaRef?.setSelectionRange(caret, caret);
      if (textareaRef) autoResize(textareaRef);
      props.onComposerActivity?.();
    });
  };

  // Dictation recorder (push-to-talk)
  const dictationRecorder = createVoiceRecorder({
    maxRecordingSeconds: () => props.maxVoiceRecordingSeconds ?? 120,
    focusInput: () => textareaRef?.focus(),
    onTranscript: (t) => {
      clearVoiceError();
      insertTranscriptAtCaret(t);
    },
    onError: showVoiceError,
  });
  onCleanup(clearVoiceErrorTimer);
  let referenceRequestId = 0;
  let historyCursor = -1;
  let historyDraftSnapshot: ComposerHistoryEntry | null = null;

  const sessionKey = () => props.sessionId?.trim() || null;
  const inlineParts = () => normalizeDisplayPartAnchors([
    ...displayParts(),
    ...(text() ? [{ type: 'text' as const, text: text() }] : []),
  ]);
  const inlineAttachments = () => attachmentsFromDisplayParts(inlineParts());
  const hasInlineParts = () => inlineParts().some((part) => part.type === 'file_ref');
  const hasInlineComposerChips = () => Boolean(commandPrefix()) || displayParts().length > 0;
  const canSend = () => (text().trim().length > 0 || attachments().length > 0 || displayParts().length > 0 || Boolean(commandPrefix())) && !props.disabled;
  const isActive = () => canSend() && focused();
  const hasAttachments = () => attachments().length > 0;
  const showPaperclip = () => true;
  const compactComposer = () => composerWidth() > 0 && composerWidth() <= COMPACT_COMPOSER_WIDTH;
  const dictationStatus = () => dictationRecorder.voiceStatus();
  const dictationButtonLabel = () => {
    switch (dictationStatus()) {
      case 'recording':
        return 'Stop recording';
      case 'transcribing':
        return 'Transcribing';
      default:
        return 'Dictate';
    }
  };
  const dictationButtonTitle = () => {
    switch (dictationStatus()) {
      case 'recording':
        return 'Stop recording';
      case 'transcribing':
        return 'Transcribing voice';
      default:
        return 'Dictate (push-to-talk)';
    }
  };
  const dictationButtonIcon = (): IconName | null => {
    switch (dictationStatus()) {
      case 'recording':
        return null;
      case 'transcribing':
        return 'loader';
      default:
        return 'mic';
    }
  };
  const submitText = () => {
    const value = text().trim();
    const prefix = commandPrefix();
    if (!prefix) return value;
    return `/${prefix.command}${value ? ` ${value}` : ''}`;
  };

  const emptyHistoryEntry = (): ComposerHistoryEntry => ({
    text: '',
    commandPrefix: null,
    attachments: [],
    displayParts: [],
  });

  const cloneDisplayParts = (parts: readonly UserDisplayPart[] | null | undefined): UserDisplayPart[] =>
    (parts ?? []).map((part) => ({ ...part }));

  const cloneAttachments = (items: readonly unknown[] | null | undefined): AttachmentChip[] =>
    (items ?? [])
      .filter((item): item is AttachmentChip => {
        if (typeof item !== 'object' || item === null) return false;
        const value = item as Partial<AttachmentChip>;
        return typeof value.id === 'string' && typeof value.kind === 'string' && typeof value.name === 'string';
      })
      .map((item) => ({ ...item }));

  const messageText = (message: RenderedMessage): string => {
    return message.blocks
      .filter((block): block is Extract<RenderedMessage['blocks'][number], { type: 'text' }> => block.type === 'text')
      .map((block) => block.content)
      .join('')
      .trim() || message.submitText?.trim() || '';
  };

  const historyEntryFromMessage = (message: RenderedMessage): ComposerHistoryEntry | null => {
    if (message.slashCommand) {
      const args = message.slashCommand.args.trim();
      return {
        text: args,
        commandPrefix: { command: message.slashCommand.command },
        attachments: [],
        displayParts: [],
      };
    }

    const parts = cloneDisplayParts(message.displayParts);
    if (parts.length > 0) {
      const last = parts[parts.length - 1];
      const trailingText = last?.type === 'text' ? last.text : '';
      const displayOnlyParts = trailingText ? parts.slice(0, -1) : parts;
      return {
        text: trailingText,
        commandPrefix: null,
        attachments: [],
        displayParts: displayOnlyParts,
      };
    }

    const entryText = messageText(message);
    const entryAttachments = cloneAttachments(message.attachments);
    if (!entryText && entryAttachments.length === 0) return null;
    return {
      text: entryText,
      commandPrefix: null,
      attachments: entryAttachments,
      displayParts: [],
    };
  };

  const userInputHistory = createMemo(() => {
    const history: ComposerHistoryEntry[] = [];
    const source = props.historyMessages ?? [];

    for (let index = source.length - 1; index >= 0; index -= 1) {
      const message = source[index];
      if (!message || message.role !== 'user') continue;
      const entry = historyEntryFromMessage(message);
      if (entry) history.push(entry);
    }

    return history;
  });

  const resetHistoryBrowse = () => {
    historyCursor = -1;
    historyDraftSnapshot = null;
  };

  const snapshotHistoryEntry = (): ComposerHistoryEntry => ({
    text: text(),
    commandPrefix: commandPrefix() ? { ...commandPrefix()! } : null,
    attachments: attachments().map((attachment) => ({ ...attachment })),
    displayParts: cloneDisplayParts(displayParts()),
  });

  const loadHistoryEntry = (entry: ComposerHistoryEntry) => {
    setCommandPrefix(entry.commandPrefix ? { ...entry.commandPrefix } : null);
    setAttachments(entry.attachments.map((attachment) => ({ ...attachment })));
    setDisplayParts(cloneDisplayParts(entry.displayParts));
    setText(entry.text);
    queueMicrotask(() => {
      textareaRef?.focus();
      if (textareaRef) {
        textareaRef.selectionStart = textareaRef.value.length;
        textareaRef.selectionEnd = textareaRef.value.length;
        autoResize(textareaRef);
      }
    });
  };

  const browseHistoryBackward = (): boolean => {
    if (historyCursor < 0 && (commandPrefix() || attachments().length > 0 || displayParts().length > 0)) return false;
    if (historyCursor < 0 && text().trim()) return false;

    const history = userInputHistory();
    if (history.length === 0) return false;

    if (historyCursor < 0) {
      historyDraftSnapshot = snapshotHistoryEntry();
      historyCursor = 0;
    } else if (historyCursor < history.length - 1) {
      historyCursor += 1;
    } else {
      return true;
    }

    loadHistoryEntry(history[historyCursor] ?? emptyHistoryEntry());
    return true;
  };

  const browseHistoryForward = (): boolean => {
    if (historyCursor < 0) return false;

    const history = userInputHistory();

    if (historyCursor > 0) {
      historyCursor -= 1;
      loadHistoryEntry(history[historyCursor] ?? emptyHistoryEntry());
      return true;
    }

    const draft = historyDraftSnapshot ?? emptyHistoryEntry();
    resetHistoryBrowse();
    loadHistoryEntry(draft);
    return true;
  };

  const slashFilter = (): string => {
    if (attachments().length > 0 || displayParts().length > 0 || commandPrefix()) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    return t.slice(1);
  };

  const slashPartial = (): string => {
    if (attachments().length > 0 || displayParts().length > 0 || commandPrefix()) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    const firstLine = t.split('\n', 1)[0];
    const firstToken = firstLine.split(/\s+/, 1)[0];
    return firstToken || '/';
  };

  const isSlashMode = () => {
    const t = text();
    return !commandPrefix() && attachments().length === 0 && displayParts().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n') && slashPanelOpen();
  };

  const referenceToken = (): string | null => {
    return referenceTokenRange()?.token ?? null;
  };

  const referenceTokenRange = (): { token: string; start: number; end: number } | null => {
    if (commandPrefix()) return null;
    const t = text();
    const re = /(?:^|\s)(@[^\s]*)/g;
    let found: RegExpExecArray | null = null;
    let next: RegExpExecArray | null;
    while ((next = re.exec(t)) !== null) {
      found = next;
    }
    if (!found) return null;
    const raw = found[0];
    const token = found[1];
    const start = found.index + raw.indexOf(token);
    return { token, start, end: start + token.length };
  };

  const isReferenceMode = () => {
    return Boolean(referenceToken() && referencePanelOpen());
  };

  const handleSend = async () => {
    const value = submitText();
    const parts = inlineParts();
    const inlineAt = inlineAttachments();
    const sendValue = hasInlineParts() ? llmMessageFromDisplayParts(parts) : value;
    if ((!sendValue && attachments().length === 0 && inlineAt.length === 0) || props.disabled) return;
    const atts = inlineAt.length > 0 ? inlineAt : attachments().length > 0 ? attachments() : undefined;
    const result = hasInlineParts()
      ? await props.onSend(sendValue, atts, parts)
      : await props.onSend(sendValue, atts);
    if (result !== false) {
      setText('');
      setAttachments([]);
      setDisplayParts([]);
      setCommandPrefix(null);
      const sid = sessionKey();
      if (sid) clearComposerDraft(sid);
      if (textareaRef) {
        textareaRef.style.height = 'auto';
      }
    }
  };

  const loadSlashCommands = async () => {
    const gateway = getGateway();
    if (!gateway) return;
    try {
      const results = await gateway.complete.slash({ partial: slashPartial() });
      setSlashCommands(filterDesktopSlashCommands(results.map((r) => ({
        command: r.command,
        description: r.description,
        category: r.category,
        icon: r.icon,
      }))));
    } catch {
      // ignore
    }
  };

  const handleSlashSelect = (cmd: SlashCommand) => {
    setCommandPrefix({ command: cmd.command, icon: cmd.icon });
    setText('');
    setSlashPanelOpen(false);
    if (textareaRef) {
      textareaRef.focus();
      autoResize(textareaRef);
    }
  };

  const referenceIcon = (kind: ReferenceKind): string => {
    switch (kind) {
      case 'folder': return 'folder';
      case 'image': return 'image';
      case 'url': return 'globe';
      case 'git': return 'git-branch';
      case 'diff':
      case 'staged':
      case 'tool': return 'terminal';
      case 'file':
      default: return 'file-code';
    }
  };

  const referenceCompletionItems = createMemo((): CompletionItem[] => referenceItems().map((item) => ({
    id: item.refText,
    title: item.display,
    description: item.description,
    icon: <Icon name={referenceIcon(item.kind) as any} size={12} />,
    data: item,
  })));

  const textValue = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

  const normalizeCompletionEntries = (value: unknown): CompletionEntry[] => {
    const items = value && typeof value === 'object' && 'items' in value
      ? (value as { items?: unknown }).items
      : value;
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is CompletionEntry =>
        Boolean(item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string'))
      .map((item) => ({ text: item.text, display: item.display, meta: item.meta }));
  };

  const fallbackStarters = (token: string): ReferenceCompletion[] => {
    const query = token.slice(1).replace(/:.*$/, '').toLowerCase();
    return REFERENCE_STARTERS.filter((item) => item.refText.slice(1, -1).startsWith(query));
  };

  const mergeWithLocalStarters = (items: ReferenceCompletion[], token: string): ReferenceCompletion[] => {
    if (token.includes(':') && !token.endsWith(':')) return items;
    const seen = new Set(items.map((item) => item.refText));
    const merged = [...items];
    for (const starter of fallbackStarters(token)) {
      if (!seen.has(starter.refText)) {
        seen.add(starter.refText);
        merged.push(starter);
      }
    }
    return merged;
  };

  const classifyReferenceCompletion = (entry: CompletionEntry): ReferenceCompletion | null => {
    const refText = entry.text.trim();
    if (!refText.startsWith('@')) return null;
    const typed = refText.match(REF_PREFIX_RE);
    const simple = refText.match(SIMPLE_REF_RE);
    const display = textValue(entry.display, refText);
    const description = textValue(entry.meta);

    if (typed) {
      const kind = typed[1] as ReferenceKind;
      const value = typed[2] ?? '';
      if (!value) {
        return {
          kind,
          refText,
          display,
          description,
          type: 'starter',
        };
      }
      if (kind === 'file' || kind === 'folder') {
        return {
          kind,
          refText,
          display,
          description: description || (kind === 'folder' ? 'Folder reference' : 'File reference'),
          type: 'pathRef',
          path: value,
        };
      }
      if (kind === 'url' || kind === 'git') {
        return {
          kind,
          refText,
          display,
          description,
          type: 'contextRef',
          path: value,
        };
      }
      return {
        kind,
        refText,
        display,
        description,
        type: 'starter',
      };
    }

    if (simple) {
      const kind = simple[1] as ReferenceKind;
      return {
        kind,
        refText,
        display,
        description,
        type: 'contextRef',
      };
    }

    return {
      kind: 'tool',
      refText,
      display,
      description,
      type: 'contextRef',
    };
  };

  const loadReferenceItems = async () => {
    const token = referenceToken();
    const requestId = ++referenceRequestId;
    if (!token) {
      setReferenceItems([]);
      return;
    }

    const match = token.match(REF_PREFIX_RE);
    if (match && (match[1] === 'image' || match[1] === 'tool')) {
      setReferenceItems(mergeWithLocalStarters([], token));
      return;
    }

    if (match && !match[2]) {
      setReferenceItems(mergeWithLocalStarters([], token));
      return;
    }

    const requestToken = token;
    const requestSessionId = sessionKey();
    const requestCwd = props.cwd ?? '';

    const gateway = getGateway();
    if (!gateway || !requestSessionId) {
      setReferenceItems(mergeWithLocalStarters([], token));
      return;
    }

    try {
      const result = await gateway.complete.path({ partial: token, sessionId: requestSessionId });
      if (
        requestId !== referenceRequestId ||
        referenceToken() !== requestToken ||
        sessionKey() !== requestSessionId ||
        (props.cwd ?? '') !== requestCwd
      ) {
        return;
      }
      const completions = normalizeCompletionEntries(result)
        .map((entry) => classifyReferenceCompletion(entry))
        .filter((item): item is ReferenceCompletion => Boolean(item));
      setReferenceItems(mergeWithLocalStarters(completions, token));
    } catch {
      if (
        requestId === referenceRequestId &&
        referenceToken() === requestToken &&
        sessionKey() === requestSessionId &&
        (props.cwd ?? '') === requestCwd
      ) {
        setReferenceItems(mergeWithLocalStarters([], token));
      }
    }
  };

  const handleReferenceSelect = (item: ReferenceCompletion) => {
    if (item.type === 'starter') {
      setText(item.refText);
      setReferencePanelOpen(false);
      if (textareaRef) {
        textareaRef.focus();
        autoResize(textareaRef);
      }
      return;
    }

    if (item.type === 'pathRef' && (item.kind === 'file' || item.kind === 'folder')) {
      const chip = makePathChip(item.kind, item.path ?? item.refText.replace(REF_PREFIX_RE, '$2'));
      const detail = item.kind === 'file' ? parseFileRefDetail(item.refText) : item.path;
      const nextChip = { ...chip, name: item.display || chip.name, detail: detail ?? chip.detail, refText: item.refText };
      const range = referenceTokenRange();
      const current = text();
      const before = range ? current.slice(0, range.start) : '';
      const after = range ? current.slice(range.end) : '';
      const part = makeFileDisplayPart(nextChip, item.refText);
      setDisplayParts((prev) => normalizeDisplayPartAnchors([
        ...prev,
        ...(before ? [{ type: 'text' as const, text: before }] : []),
        part,
      ]));
      setText(after);
      setReferencePanelOpen(false);
      queueMicrotask(() => textareaRef?.focus());
      return;
    }

    if (item.type === 'contextRef') {
      const chip = makeContextChip(item);
      setAttachments((prev) => prev.some((existing) => existing.id === chip.id || existing.refText === chip.refText)
        ? prev
        : [...prev, chip]);
      setText('');
      setReferencePanelOpen(false);
      queueMicrotask(() => textareaRef?.focus());
    }
  };

  const handleReferenceClose = () => {
    setReferenceManuallyClosed(true);
    setReferencePanelOpen(false);
  };

  const handleSlashClose = () => {
    setManuallyClosed(true);
    setSlashPanelOpen(false);
  };

  createEffect(() => {
    const t = text();
    if (!commandPrefix() && attachments().length === 0 && displayParts().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n')) {
      void loadSlashCommands();
      if (!slashPanelOpen() && !manuallyClosed()) {
        setSlashPanelOpen(true);
      }
    } else {
      setSlashPanelOpen(false);
      setManuallyClosed(false);
    }
  });

  createEffect(() => {
    const token = referenceToken();
    if (token && !referenceManuallyClosed()) {
      void loadReferenceItems();
      if (!referencePanelOpen()) {
        setReferencePanelOpen(true);
      }
    } else {
      setReferencePanelOpen(false);
      setReferenceManuallyClosed(false);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    // While the slash autocomplete panel is open, let it own navigation +
    // Enter-to-select. preventDefault keeps the textarea caret/newline still;
    // we DON'T stopPropagation so the panel's document listener acts next.
    // (Cmd/Ctrl+Enter skips this and falls through to the send branch below.)
    if (
      isSlashMode() && !e.metaKey && !e.ctrlKey &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape' ||
       e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))
    ) {
      if (e.key !== 'Escape') e.preventDefault();
      return;
    }
    if (
      isReferenceMode() && !e.metaKey && !e.ctrlKey &&
      (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape' ||
       e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))
    ) {
      if (e.key !== 'Escape') e.preventDefault();
      return;
    }
    if (
      e.key === 'Backspace' &&
      commandPrefix() &&
      text() === '' &&
      textareaRef?.selectionStart === 0 &&
      textareaRef?.selectionEnd === 0
    ) {
      e.preventDefault();
      setCommandPrefix(null);
      resetHistoryBrowse();
      queueMicrotask(() => {
        textareaRef?.focus();
        if (textareaRef) autoResize(textareaRef);
      });
      return;
    }
    if (
      e.key === 'Backspace' &&
      !commandPrefix() &&
      text() === '' &&
      textareaRef?.selectionStart === 0 &&
      textareaRef?.selectionEnd === 0
    ) {
      const parts = displayParts();
      if (parts.length > 0) {
        e.preventDefault();
        setDisplayParts((prev) => {
          const next = [...prev];
          let last = next[next.length - 1];
          while (last?.type === 'text' && !last.text.trim()) {
            next.pop();
            last = next[next.length - 1];
          }
          if (next.length > 0) next.pop();
          return next;
        });
        resetHistoryBrowse();
        queueMicrotask(() => textareaRef?.focus());
        return;
      }

      if (attachments().length > 0) {
        e.preventDefault();
        setAttachments((prev) => prev.slice(0, -1));
        resetHistoryBrowse();
        queueMicrotask(() => textareaRef?.focus());
        return;
      }
    }
    if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (browseHistoryBackward()) {
        e.preventDefault();
        return;
      }
    }
    if (e.key === 'ArrowDown' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (browseHistoryForward()) {
        e.preventDefault();
        return;
      }
    }
    // Enter sends the message (Shift+Enter inserts a newline). During IME
    // composition (e.g. 中文, 日本語) Enter confirms a character — we must NOT
    // send in that case. Cmd/Ctrl+Enter also sends as a power-user shortcut
    // and IME fallback; the condition below covers that since both modifiers
    // set isComposing to false.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setSlashPanelOpen(false);
      void handleSend();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    const nextValue = target.value;
    const current = text();
    resetHistoryBrowse();
    if (displayParts().length > 0 && current && nextValue.startsWith('@') && !current.startsWith('@')) {
      setDisplayParts((prev) => compactDisplayParts([...prev, { type: 'text', text: /\s$/.test(current) ? current : `${current} ` }]));
    }
    setText(nextValue);
    autoResize(target);
    props.onComposerActivity?.();
  };

  const autoResize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    const maxHeight = 200;
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
  };

  const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path;

  const stableId = (kind: AttachmentChip['kind'], value: string): string => `${kind}:${value}`;

  const quoteRefValue = (value: string): string => {
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return /[\s"'`]/.test(value) ? `"${escaped}"` : value;
  };

  const contextPath = (path: string): string => {
    const cwd = props.cwd?.replace(/\/+$/, '');
    if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1);
    return path;
  };

  const makePathChip = (kind: 'file' | 'folder' | 'image', path: string): AttachmentChip => {
    const name = basename(path);
    if (kind === 'image') {
      return { id: stableId(kind, path), kind, name, path, size: 0 };
    }
    const prefix = kind === 'folder' ? '@folder:' : '@file:';
    const detail = contextPath(path);
    return {
      id: stableId(kind, path),
      kind,
      name,
      detail: detail && detail !== name ? detail : undefined,
      path,
      size: 0,
      refText: `${prefix}${quoteRefValue(detail)}`,
    };
  };

  const makeContextChip = (item: ReferenceCompletion): AttachmentChip => {
    const kind: AttachmentChip['kind'] = item.kind === 'url' ? 'url' : 'terminal';
    const name = item.display || item.refText;
    return {
      id: stableId(kind, item.refText),
      kind,
      name,
      size: 0,
      refText: item.refText,
    };
  };

  const makeFileDisplayPart = (chip: AttachmentChip, refText: string): UserFileRefDisplayPart => {
    const lines = parseFileRefLineRange(refText);
    return {
      type: 'file_ref',
      refText,
      name: chip.name,
      detail: parseFileRefDetail(refText) ?? chip.detail,
      anchor: 'File 1',
      ...lines,
    };
  };

  const addPaths = (kind: 'file' | 'folder' | 'image', paths: string[]) => {
    setAttachments((prev) => {
      const seen = new Set(prev.map((chip) => chip.id));
      const next = [...prev];
      for (const path of paths) {
        const chip = makePathChip(kind, path);
        if (!seen.has(chip.id)) {
          seen.add(chip.id);
          next.push(chip);
        }
      }
      return next;
    });
    queueMicrotask(() => textareaRef?.focus());
  };

  const selectPaths = async (kind: 'file' | 'folder' | 'image') => {
    setAttachMenuOpen(false);
    const selected = await open({
      multiple: true,
      directory: kind === 'folder',
      filters: kind === 'image'
        ? [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'tif', 'heic'] }]
        : [],
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    addPaths(kind, files);
  };

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((chip) => chip.id !== id));
  };

  /**
   * Paste handler: when the clipboard holds an image, read it via the Rust
   * command (which writes it to a temp file), then attach via the existing
   * path-based `image` chip flow — zero backend changes. Text paste falls
   * through to the default textarea behavior.
   */
  const handlePaste = (e: ClipboardEvent) => {
    if (!isTauri()) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const hasImage = Array.from(items).some((item) => item.kind === 'file' && item.type.startsWith('image/'));
    if (!hasImage) return;
    e.preventDefault();
    void invoke<string | null>('read_clipboard_image').then((path) => {
      if (path) addPaths('image', [path]);
    }).catch(() => {
      /* best-effort — paste silently no-ops on failure */
    });
  };

  const isWorkspaceBound = (chip: AttachmentChip): boolean =>
    chip.kind === 'file' || chip.kind === 'folder' ||
    Boolean(
      chip.refText?.startsWith('@file:') ||
      chip.refText?.startsWith('@folder:') ||
      chip.refText === '@diff' ||
      chip.refText === '@staged' ||
      chip.refText?.startsWith('@git:'),
    );

  const restoreAttachments = (draftAttachments: AttachmentChip[], draftCwd: string | null, currentCwd: string | null): AttachmentChip[] =>
    draftAttachments
      .filter((chip) => chip.kind === 'image' || !isWorkspaceBound(chip) || draftCwd === currentCwd)
      .map((chip) => ({ ...chip }));

  const snapshotDraft = () => ({
    text: text(),
    commandPrefix: commandPrefix(),
    attachments: attachments().map((attachment) => ({ ...attachment })),
    displayParts: displayParts().map((part) => ({ ...part })),
    cwd: props.cwd ?? null,
  });

  const saveCurrentDraft = (sid: string | null) => {
    if (!sid) return;
    const draft = snapshotDraft();
    if (!draft.text.trim() && !draft.commandPrefix && draft.attachments.length === 0 && !draft.displayParts.length) {
      clearComposerDraft(sid);
      return;
    }
    saveComposerDraft(sid, draft);
  };

  const loadDraft = (sid: string | null) => {
    const draft = sid ? getComposerDraft(sid) : null;
    if (!draft) {
      setText('');
      setCommandPrefix(null);
      setAttachments([]);
      setDisplayParts([]);
      return;
    }
    setText(draft.text);
    setCommandPrefix(draft.commandPrefix);
    setAttachments(restoreAttachments(draft.attachments as AttachmentChip[], draft.cwd, props.cwd ?? null));
    setDisplayParts(draft.cwd === (props.cwd ?? null) ? (draft.displayParts ?? []).map((part) => ({ ...part })) : []);
  };

  createEffect(() => {
    const nextSessionId = sessionKey();
    props.cwd;
    if (previousSessionId === undefined) {
      previousSessionId = nextSessionId;
      untrack(() => loadDraft(nextSessionId));
      return;
    }
    if (previousSessionId === nextSessionId) return;
    resetHistoryBrowse();
    const oldSessionId = previousSessionId;
    untrack(() => saveCurrentDraft(oldSessionId));
    previousSessionId = nextSessionId;
    untrack(() => loadDraft(nextSessionId));
    queueMicrotask(() => {
      if (textareaRef) autoResize(textareaRef);
    });
  });

  createEffect(() => {
    if (textareaRef && text() === '') {
      textareaRef.style.height = 'auto';
    }
  });

  createEffect(() => {
    const draft = props.editDraft?.();
    if (draft != null) {
      setText(draft);
      setCommandPrefix(null);
      props.clearEditDraft?.();
      if (textareaRef) {
        autoResize(textareaRef);
        textareaRef.focus();
      }
    }
  });

  createEffect(() => {
    const chips = fileChipQueue.pending();
    if (chips.length > 0) {
      const asAttachments = fileChipQueue.flush().map(c => makePathChip('file', c.path));
      setAttachments(prev => [...prev, ...asAttachments]);
    }
  });

  let previousCwd: string | null | undefined = props.cwd;
  createEffect(() => {
    const nextCwd = props.cwd;
    if (previousCwd !== undefined && previousCwd !== nextCwd) {
      setAttachments((prev) => prev.filter((chip) => chip.kind === 'image'));
      setDisplayParts([]);
    }
    previousCwd = nextCwd;
  });

  onMount(() => {
    const updateComposerWidth = () => {
      setComposerWidth(wrapperRef?.clientWidth ?? 0);
    };

    updateComposerWidth();
    if (!wrapperRef || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(updateComposerWidth);
    observer.observe(wrapperRef);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={(el) => { wrapperRef = el; }}
      class={styles.wrapper}
      classList={{ [styles.wrapperCompact]: compactComposer() }}
    >
      <Show when={hasAttachments()}>
        <div class={styles.attachmentBar} data-testid="attachment-chip-bar">
          <AttachmentChips attachments={attachments()} onRemove={removeAttachment} />
        </div>
      </Show>
      <div
        class={styles.inputContainer}
        classList={{
          [styles.inputContainerActive]: isActive(),
          [styles.inputContainerSending]: props.disabled && !props.isStreaming,
        }}
      >
        <SlashCommandPanel
          commands={slashCommands()}
          filter={slashFilter()}
          visible={isSlashMode() && !props.disabled}
          onSelect={handleSlashSelect}
          onClose={handleSlashClose}
        />
        <CompletionPanel
          visible={isReferenceMode() && !props.disabled}
          header={
            <>
              <Icon name="search" size={12} />
              <span>References</span>
            </>
          }
          items={referenceCompletionItems()}
          onSelect={(item) => handleReferenceSelect(item.data as ReferenceCompletion)}
          onClose={handleReferenceClose}
        />

        {/* Textarea */}
        <div
          class={styles.textareaRow}
          classList={{ [styles.textareaRowWithInlineChips]: hasInlineComposerChips() }}
        >
          <Show when={commandPrefix()}>
            {(prefix) => (
              <div class={styles.commandChip}>
                <Icon name={(prefix().icon ?? 'terminal') as any} size={12} class={styles.chipIcon} />
                <span>/{prefix().command}</span>
              </div>
            )}
          </Show>
          <For each={displayParts()}>
            {(part) => (
              <Show
                when={part.type === 'file_ref'}
                fallback={<span class={styles.inlineComposerText}>{part.type === 'text' ? part.text : ''}</span>}
              >
                <span class={styles.inlineFileChip} data-testid="inline-file-chip">
                  <Icon name="file-code" size={12} class={styles.chipIcon} />
                  <span>{fileRefLabel(part as UserFileRefDisplayPart)}</span>
                </span>
              </Show>
            )}
          </For>
          <textarea
            ref={textareaRef}
            class={styles.textarea}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder ?? 'Message Hermes...'}
            disabled={props.disabled}
            rows={1}
          />
        </div>

        <VoicePlaybackActivity />

        {/* Toolbar */}
        <div class={styles.toolbar}>
          <div class={styles.toolbarLeft}>
            <Show when={showPaperclip()}>
              <div class={styles.attachMenuWrap}>
                <button
                  class={styles.actionBtn}
                  type="button"
                  aria-label="Add attachment"
                  onClick={() => setAttachMenuOpen((open) => !open)}
                  disabled={props.disabled}
                >
                  <Icon name="paperclip" size={16} />
                </button>
                <Show when={attachMenuOpen() && !props.disabled}>
                  <div class={styles.attachMenu}>
                    <button type="button" onClick={() => void selectPaths('file')}>
                      <Icon name="file-code" size={14} />
                      <span>Add files</span>
                    </button>
                    <button type="button" onClick={() => void selectPaths('folder')}>
                      <Icon name="folder" size={14} />
                      <span>Add folders</span>
                    </button>
                    <button type="button" onClick={() => void selectPaths('image')}>
                      <Icon name="image" size={14} />
                      <span>Add images</span>
                    </button>
                  </div>
                </Show>
              </div>
            </Show>
            <Show when={props.modelSlot}>
              <div class={styles.modelPill}>
                {props.modelSlot!(
                  Boolean(props.disabled && !props.isStreaming),
                  false,
                  compactComposer(),
                )}
              </div>
            </Show>
          </div>

          <div class={styles.toolbarRight}>
            <PermissionModePicker
              disabled={props.disabled || !props.onPermissionModeChange}
              mode={props.permissionMode ?? 'auto'}
              pending={props.permissionModePending}
              appliesNextTurn={props.permissionModeAppliesNextTurn}
              compact={compactComposer()}
              onChange={(mode) => props.onPermissionModeChange?.(mode)}
            />
            <Show when={dictationRecorder.voiceStatus() !== 'idle'}>
              <VoiceActivity class={styles.voiceActivityInline} state={dictationRecorder.voiceActivityState()} />
            </Show>
            <Show when={voiceError()}>
              <div class={`${styles.voiceActivityInline} ${styles.voiceError}`} role="alert" title={voiceError()}>
                {voiceError()}
              </div>
            </Show>
            <Show when={!props.isStreaming}>
              <button
                class={styles.actionBtn}
                classList={{
                  [styles.actionBtnActive]: dictationStatus() !== 'idle',
                  [styles.voiceActionRecording]: dictationStatus() === 'recording',
                  [styles.voiceActionProcessing]: dictationStatus() === 'transcribing',
                }}
                type="button"
                aria-label={dictationButtonLabel()}
                title={dictationButtonTitle()}
                disabled={!!props.disabled}
                onClick={() => {
                  clearVoiceError();
                  if (props.sttEnabled === false) {
                    showVoiceError('Speech to text disabled');
                    textareaRef?.focus();
                    return;
                  }
                  dictationRecorder.dictate();
                }}
              >
                <Show keyed when={dictationButtonIcon()} fallback={<span aria-hidden="true" class={styles.voiceStopGlyph} />}>
                  {(iconName) => <Icon name={iconName} size={16} />}
                </Show>
              </button>
            </Show>
            <Show
              when={!props.isStreaming}
              fallback={
                <button
                  class={styles.stopButton}
                  onClick={props.onStop}
                  type="button"
                  aria-label="Stop generation"
                >
                  <Icon name="square" size={12} />
                  <span>Stop generating</span>
                </button>
              }
            >
              <button
                class={styles.sendButton}
                classList={{ [styles.sendButtonDisabled]: !canSend() }}
                onClick={() => void handleSend()}
                type="button"
                aria-label="Send message"
                disabled={!canSend()}
              >
                <Icon name="send" size={14} />
              </button>
            </Show>
          </div>
        </div>
        <div class={styles.composerStatusRow} aria-label="Composer context">
          <ContextUsageBar
            contextUsed={props.contextUsage?.contextUsed ?? null}
            contextMax={props.contextUsage?.contextMax ?? null}
            contextPercent={props.contextUsage?.contextPercent ?? null}
            costUsd={props.contextUsage?.costUsd ?? null}
            totalTokens={props.contextUsage?.totalTokens ?? null}
          />
          <div class={styles.statusContextGroup}>
            <WorkspacePicker
              sessionId={props.sessionId}
              workspacePath={props.cwd}
              editable={props.isNewConversation}
              disabled={props.disabled}
              onChange={props.onCwdChange}
            />
            <GitBranchPicker
              sessionId={props.sessionId}
              workspacePath={props.cwd}
              disabled={props.disabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
