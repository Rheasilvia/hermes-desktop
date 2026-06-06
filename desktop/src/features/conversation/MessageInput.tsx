import type { Accessor, Component } from 'solid-js';
import { createSignal, createEffect, Show } from 'solid-js';
import { fileChipQueue } from '@/stores/file-chip-queue.js';
import { open } from '@tauri-apps/plugin-dialog';
import { Icon } from '@/ui/atoms/Icon';
import { WorkspacePicker } from './WorkspacePicker';
import { GitBranchPicker } from './GitBranchPicker';
import { SlashCommandPanel, type SlashCommand } from './SlashCommandPanel';
import { ContextUsageBar, type ContextUsageProps } from './ContextUsageBar';
import { AttachmentChips, type AttachmentChip } from './composer/AttachmentChips.js';
import { getGateway } from '@/stores/context.js';
import { filterDesktopSlashCommands } from './slashCommandCuration.js';
import styles from './MessageInput.module.css';

interface MessageInputProps {
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

export const MessageInput: Component<MessageInputProps> = (props) => {
  const [text, setText] = createSignal('');
  const [focused, setFocused] = createSignal(false);
  const [attachments, setAttachments] = createSignal<AttachmentChip[]>([]);
  const [attachMenuOpen, setAttachMenuOpen] = createSignal(false);
  const [slashCommands, setSlashCommands] = createSignal<SlashCommand[]>([]);
  const [slashPanelOpen, setSlashPanelOpen] = createSignal(false);
  const [manuallyClosed, setManuallyClosed] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const canSend = () => (text().trim().length > 0 || attachments().length > 0) && !props.disabled;
  const isActive = () => canSend() && focused();
  const hasAttachments = () => attachments().length > 0;
  const showPaperclip = () => true;

  const slashFilter = (): string => {
    if (attachments().length > 0) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    return t.slice(1);
  };

  const slashPartial = (): string => {
    if (attachments().length > 0) return '';
    const t = text();
    if (!t.startsWith('/')) return '';
    const firstLine = t.split('\n', 1)[0];
    const firstToken = firstLine.split(/\s+/, 1)[0];
    return firstToken || '/';
  };

  const isSlashMode = () => {
    const t = text();
    return attachments().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n') && slashPanelOpen();
  };

  const handleSend = async () => {
    const value = text().trim();
    if ((!value && attachments().length === 0) || props.disabled) return;
    const atts = attachments().length > 0 ? attachments() : undefined;
    const result = await props.onSend(value, atts);
    if (result !== false) {
      setText('');
      setAttachments([]);
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
    setText(`/${cmd.command} `);
    setSlashPanelOpen(false);
    if (textareaRef) {
      textareaRef.focus();
      autoResize(textareaRef);
    }
  };

  const handleSlashClose = () => {
    setManuallyClosed(true);
    setSlashPanelOpen(false);
  };

  createEffect(() => {
    const t = text();
    if (attachments().length === 0 && t.startsWith('/') && !t.includes(' ') && !t.includes('\n')) {
      void loadSlashCommands();
      if (!slashPanelOpen() && !manuallyClosed()) {
        setSlashPanelOpen(true);
      }
    } else {
      setSlashPanelOpen(false);
      setManuallyClosed(false);
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

  createEffect(() => {
    if (textareaRef && text() === '') {
      textareaRef.style.height = 'auto';
    }
  });

  createEffect(() => {
    const draft = props.editDraft?.();
    if (draft != null) {
      setText(draft);
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
        <Show when={hasAttachments()}>
          <AttachmentChips attachments={attachments()} onRemove={removeAttachment} />
        </Show>

        {/* Textarea */}
        <div
          class={styles.textareaRow}
          classList={{ [styles.textareaRowCompact]: hasAttachments() }}
        >
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
