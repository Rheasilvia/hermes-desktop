import type { Accessor, Component } from 'solid-js';
import { createSignal, createEffect, Show, createMemo, untrack } from 'solid-js';
import { fileChipQueue } from '@/stores/file-chip-queue.js';
import {
  clearComposerDraft,
  getComposerDraft,
  saveComposerDraft,
  type ComposerCommandPrefix,
} from '@/stores/composer-drafts.js';
import { open } from '@tauri-apps/plugin-dialog';
import { Icon } from '@/ui/atoms/Icon';
import { WorkspacePicker } from './WorkspacePicker';
import { GitBranchPicker } from './GitBranchPicker';
import { SlashCommandPanel, type SlashCommand } from './SlashCommandPanel';
import { ContextUsageBar, type ContextUsageProps } from './ContextUsageBar';
import { AttachmentChips, type AttachmentChip } from './composer/AttachmentChips.js';
import { CompletionPanel, type CompletionItem } from './composer/CompletionPanel.js';
import { getGateway } from '@/stores/context.js';
import { filterDesktopSlashCommands } from './slashCommandCuration.js';
import styles from './MessageInput.module.css';

interface MessageInputProps {
  sessionId?: string | null;
  onSend: (text: string, attachments?: AttachmentChip[]) => boolean | Promise<boolean | void> | void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  modelSlot?: (dimmed: boolean, disabled: boolean) => any;
  cwd?: string | null;
  isNewConversation?: boolean;
  onCwdChange?: (path: string) => void;
  editDraft?: Accessor<string | null>;
  clearEditDraft?: () => void;
  contextUsage?: ContextUsageProps;
}

type ReferenceKind = 'file' | 'folder' | 'image' | 'url' | 'tool';

interface ReferenceCompletion {
  kind: ReferenceKind;
  refText: string;
  description: string;
  starter: boolean;
  path?: string;
}

const REFERENCE_STARTERS: ReferenceCompletion[] = [
  { kind: 'file', refText: '@file:', description: 'Attach a file reference', starter: true },
  { kind: 'folder', refText: '@folder:', description: 'Attach a folder reference', starter: true },
  { kind: 'url', refText: '@url:', description: 'Attach a URL reference', starter: true },
  { kind: 'image', refText: '@image:', description: 'Attach an image reference', starter: true },
  { kind: 'tool', refText: '@tool:', description: 'Attach tool context', starter: true },
];

const REF_PREFIX_RE = /^@(file|folder|image|url|tool):(.*)$/;

export const MessageInput: Component<MessageInputProps> = (props) => {
  const [text, setText] = createSignal('');
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
  let textareaRef: HTMLTextAreaElement | undefined;
  let previousSessionId: string | null | undefined;

  const sessionKey = () => props.sessionId?.trim() || null;
  const canSend = () => (text().trim().length > 0 || attachments().length > 0 || Boolean(commandPrefix())) && !props.disabled;
  const isActive = () => canSend() && focused();
  const hasAttachments = () => attachments().length > 0;
  const showPaperclip = () => true;
  const submitText = () => {
    const value = text().trim();
    const prefix = commandPrefix();
    if (!prefix) return value;
    return `/${prefix.command}${value ? ` ${value}` : ''}`;
  };

  const slashFilter = (): string => {
    if (attachments().length > 0 || commandPrefix()) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    return t.slice(1);
  };

  const slashPartial = (): string => {
    if (attachments().length > 0 || commandPrefix()) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    const firstLine = t.split('\n', 1)[0];
    const firstToken = firstLine.split(/\s+/, 1)[0];
    return firstToken || '/';
  };

  const isSlashMode = () => {
    const t = text();
    return !commandPrefix() && attachments().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n') && slashPanelOpen();
  };

  const referenceToken = (): string | null => {
    if (commandPrefix()) return null;
    const t = text();
    if (!t.startsWith('@') || /\s/.test(t)) return null;
    return t;
  };

  const isReferenceMode = () => {
    return Boolean(referenceToken() && referencePanelOpen());
  };

  const handleSend = async () => {
    const value = submitText();
    if ((!value && attachments().length === 0) || props.disabled) return;
    const atts = attachments().length > 0 ? attachments() : undefined;
    const result = await props.onSend(value, atts);
    if (result !== false) {
      setText('');
      setAttachments([]);
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
      case 'tool': return 'terminal';
      case 'file':
      default: return 'file-code';
    }
  };

  const referenceCompletionItems = createMemo((): CompletionItem[] => referenceItems().map((item) => ({
    id: item.refText,
    title: item.refText,
    description: item.description,
    icon: <Icon name={referenceIcon(item.kind) as any} size={12} />,
    data: item,
  })));

  const normalizeReferenceCompletion = (kind: ReferenceKind, value: unknown): ReferenceCompletion | null => {
    const raw = typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && 'text' in value
        ? String((value as { text?: unknown }).text ?? '')
        : '';
    const cleaned = raw.trim();
    if (!cleaned) return null;
    const refText = cleaned.startsWith('@') ? cleaned : `@${kind}:${cleaned}`;
    const path = refText.replace(new RegExp(`^@${kind}:`), '');
    return {
      kind,
      refText,
      description: kind === 'folder' ? 'Folder reference' : kind === 'image' ? 'Image reference' : 'File reference',
      starter: false,
      path,
    };
  };

  const loadReferenceItems = async () => {
    const token = referenceToken();
    if (!token) {
      setReferenceItems([]);
      return;
    }

    if (!token.includes(':')) {
      const query = token.slice(1).toLowerCase();
      setReferenceItems(REFERENCE_STARTERS.filter((item) => item.refText.slice(1).startsWith(query)));
      return;
    }

    const match = token.match(REF_PREFIX_RE);
    if (!match) {
      setReferenceItems([]);
      return;
    }

    const kind = match[1] as ReferenceKind;
    const tail = match[2] ?? '';
    if (!['file', 'folder', 'image'].includes(kind) || tail.length === 0) {
      setReferenceItems([]);
      return;
    }

    const gateway = getGateway();
    if (!gateway) {
      setReferenceItems([]);
      return;
    }

    try {
      const results = await gateway.complete.path({ partial: token });
      setReferenceItems(results
        .map((result) => normalizeReferenceCompletion(kind, result))
        .filter((item): item is ReferenceCompletion => Boolean(item)));
    } catch {
      setReferenceItems([]);
    }
  };

  const handleReferenceSelect = (item: ReferenceCompletion) => {
    if (item.starter) {
      setText(item.refText);
      setReferencePanelOpen(false);
      if (textareaRef) {
        textareaRef.focus();
        autoResize(textareaRef);
      }
      return;
    }

    if (item.kind === 'file' || item.kind === 'folder' || item.kind === 'image') {
      const chip = makePathChip(item.kind, item.path ?? item.refText.replace(REF_PREFIX_RE, '$2'));
      const nextChip = item.kind === 'image' ? chip : { ...chip, refText: item.refText };
      setAttachments((prev) => prev.some((existing) => existing.id === nextChip.id || existing.refText === nextChip.refText)
        ? prev
        : [...prev, nextChip]);
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
    if (!commandPrefix() && attachments().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n')) {
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
      const prefix = commandPrefix();
      setCommandPrefix(null);
      setText(prefix ? `/${prefix.command}` : '');
      queueMicrotask(() => {
        textareaRef?.focus();
        if (textareaRef) autoResize(textareaRef);
      });
      return;
    }
    // Cmd+Enter (macOS) / Ctrl+Enter (Windows/Linux) is the only send trigger —
    // for prose messages and slash commands alike. Plain Enter / Shift+Enter
    // insert a newline, so a stray Enter can never fire off a half-typed message.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      setSlashPanelOpen(false);
      void handleSend();
    }
  };

  const handleInput = (e: Event) => {
    const target = e.target as HTMLTextAreaElement;
    setText(target.value);
    autoResize(target);
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
    return {
      id: stableId(kind, path),
      kind,
      name,
      path,
      size: 0,
      refText: `${prefix}${quoteRefValue(contextPath(path))}`,
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

  const isWorkspaceBound = (chip: AttachmentChip): boolean =>
    chip.kind === 'file' || chip.kind === 'folder' ||
    Boolean(chip.refText?.startsWith('@file:') || chip.refText?.startsWith('@folder:'));

  const restoreAttachments = (draftAttachments: AttachmentChip[], draftCwd: string | null, currentCwd: string | null): AttachmentChip[] =>
    draftAttachments
      .filter((chip) => chip.kind === 'image' || !isWorkspaceBound(chip) || draftCwd === currentCwd)
      .map((chip) => ({ ...chip }));

  const snapshotDraft = () => ({
    text: text(),
    commandPrefix: commandPrefix(),
    attachments: attachments().map((attachment) => ({ ...attachment })),
    cwd: props.cwd ?? null,
  });

  const saveCurrentDraft = (sid: string | null) => {
    if (!sid) return;
    const draft = snapshotDraft();
    if (!draft.text.trim() && !draft.commandPrefix && draft.attachments.length === 0) {
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
      return;
    }
    setText(draft.text);
    setCommandPrefix(draft.commandPrefix);
    setAttachments(restoreAttachments(draft.attachments as AttachmentChip[], draft.cwd, props.cwd ?? null));
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
    }
    previousCwd = nextCwd;
  });

  return (
    <div class={styles.wrapper}>
      <div
        class={styles.inputContainer}
        classList={{
          [styles.inputContainerActive]: isActive(),
          [styles.inputContainerSending]: props.disabled && !props.isStreaming,
          [styles.inputContainerWithAttachments]: hasAttachments(),
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
        <Show when={hasAttachments()}>
          <AttachmentChips attachments={attachments()} onRemove={removeAttachment} />
        </Show>

        {/* Textarea */}
        <div
          class={styles.textareaRow}
          classList={{ [styles.textareaRowCompact]: hasAttachments() }}
        >
          <Show when={commandPrefix()}>
            {(prefix) => (
              <div class={styles.commandChip}>
                <Icon name={(prefix().icon ?? 'terminal') as any} size={12} class={styles.chipIcon} />
                <span>/{prefix().command}</span>
              </div>
            )}
          </Show>
          <textarea
            ref={textareaRef}
            class={styles.textarea}
            value={text()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={props.placeholder ?? 'Message Hermes...'}
            disabled={props.disabled}
            rows={1}
          />
        </div>

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
              <div class={styles.modelPill}>{props.modelSlot!(Boolean(props.disabled && !props.isStreaming), Boolean(props.isStreaming))}</div>
            </Show>
            <WorkspacePicker
              workspacePath={props.cwd}
              editable={props.isNewConversation}
              disabled={!props.isNewConversation}
              onChange={props.onCwdChange}
            />
            <GitBranchPicker
              workspacePath={props.cwd}
              disabled={props.disabled}
            />
          </div>

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
        <ContextUsageBar
          contextUsed={props.contextUsage?.contextUsed ?? null}
          contextMax={props.contextUsage?.contextMax ?? null}
          contextPercent={props.contextUsage?.contextPercent ?? null}
          costUsd={props.contextUsage?.costUsd ?? null}
          totalTokens={props.contextUsage?.totalTokens ?? null}
        />
      </div>
    </div>
  );
};
