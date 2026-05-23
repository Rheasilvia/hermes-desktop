import type { Accessor, Component } from 'solid-js';
import { createSignal, createEffect, Show, For } from 'solid-js';
import { open } from '@tauri-apps/plugin-dialog';
import { Icon } from '@/ui/atoms/Icon';
import { WorkspacePicker } from './WorkspacePicker';
import { SlashCommandPanel, type SlashCommand } from './SlashCommandPanel';
import { getGateway } from '@/stores/context.js';
import styles from './MessageInput.module.css';

interface AttachmentChip {
  name: string;
  size: number;
  path: string;
}

interface MessageInputProps {
  onSend: (text: string, attachments?: AttachmentChip[]) => void;
  onStop?: () => void;
  disabled?: boolean;
  isStreaming?: boolean;
  placeholder?: string;
  modelSlot?: (dimmed: boolean, disabled: boolean) => any;
  workspacePath?: string | null;
  isNewConversation?: boolean;
  onWorkspaceChange?: (path: string) => void;
  editDraft?: Accessor<string | null>;
  clearEditDraft?: () => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

export const MessageInput: Component<MessageInputProps> = (props) => {
  const [text, setText] = createSignal('');
  const [focused, setFocused] = createSignal(false);
  const [attachments, setAttachments] = createSignal<AttachmentChip[]>([]);
  const [slashCommands, setSlashCommands] = createSignal<SlashCommand[]>([]);
  const [slashPanelOpen, setSlashPanelOpen] = createSignal(false);
  const [manuallyClosed, setManuallyClosed] = createSignal(false);
  let textareaRef: HTMLTextAreaElement | undefined;

  const canSend = () => (text().trim().length > 0 || attachments().length > 0) && !props.disabled;
  const isActive = () => canSend() && focused();
  const hasAttachments = () => attachments().length > 0;
  const showPaperclip = () => true;

  const slashFilter = (): string => {
    const t = text();
    if (!t.startsWith('/')) return '';
    return t.slice(1);
  };

  const isSlashMode = () => {
    const t = text();
    return t.startsWith('/') && !t.includes(' ') && !t.includes('\n') && slashPanelOpen();
  };

  const handleSend = () => {
    const value = text().trim();
    if ((!value && attachments().length === 0) || props.disabled) return;
    const atts = attachments().length > 0 ? attachments() : undefined;
    props.onSend(value, atts);
    setText('');
    setAttachments([]);
    if (textareaRef) {
      textareaRef.style.height = 'auto';
    }
  };

  const loadSlashCommands = async () => {
    const gateway = getGateway();
    if (!gateway) return;
    try {
      const results = await gateway.complete.slash({ partial: '' });
      setSlashCommands(results.map((r) => ({
        command: r.command,
        description: r.description,
        category: r.category,
        icon: r.icon,
      })));
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
    if (t.startsWith('/') && !t.includes(' ') && !t.includes('\n')) {
      if (!slashPanelOpen() && !manuallyClosed()) {
        setSlashPanelOpen(true);
        void loadSlashCommands();
      }
    } else {
      setSlashPanelOpen(false);
      setManuallyClosed(false);
    }
  });

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isSlashMode() && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab')) {
      // Let SlashCommandPanel handle navigation, escape, Enter, and Tab selection
      if (e.key === 'Enter' || e.key === 'Tab') e.preventDefault();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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

  const handleAttach = async () => {
    const selected = await open({
      multiple: true,
      filters: [],
    });
    if (!selected) return;
    const files = Array.isArray(selected) ? selected : [selected];
    const newChips: AttachmentChip[] = files.map((f: string) => ({
      name: f.split('/').pop() ?? 'file',
      size: 0,
      path: f,
    }));
    setAttachments((prev) => [...prev, ...newChips]);
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
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
        {/* Attachment chips */}
        <Show when={hasAttachments()}>
          <div class={styles.chipsRow}>
            <For each={attachments()}>
              {(chip, idx) => (
                <div class={styles.attachmentChip}>
                  <Icon name="file-code" size={12} class={styles.chipIcon} />
                  <span class={styles.chipName}>{chip.name}</span>
                  <button
                    class={styles.chipRemove}
                    type="button"
                    onClick={() => removeAttachment(idx())}
                    aria-label={`Remove ${chip.name}`}
                  >
                    <Icon name="x" size={10} />
                  </button>
                </div>
              )}
            </For>
          </div>
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
              <button
                class={styles.actionBtn}
                type="button"
                aria-label="Attach file"
                onClick={handleAttach}
                disabled={props.disabled}
              >
                <Icon name="paperclip" size={16} />
              </button>
            </Show>
            <Show when={props.modelSlot}>
              <div class={styles.modelPill}>{props.modelSlot!(Boolean(props.disabled && !props.isStreaming), Boolean(props.isStreaming))}</div>
            </Show>
            <WorkspacePicker
              workspacePath={props.workspacePath}
              editable={props.isNewConversation}
              disabled={!props.isNewConversation}
              onChange={props.onWorkspaceChange}
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
              onClick={handleSend}
              type="button"
              aria-label="Send message"
              disabled={!canSend()}
            >
              <Icon name="send" size={14} />
            </button>
          </Show>
        </div>
      </div>
    </div>
  );
};
