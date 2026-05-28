/**
 * Presentational file-content viewer used by both the workspace preview modal
 * and the memory editor. Caller owns data fetching and passes the resolved
 * content; this component only decides how to render it.
 *
 * - Markdown files render as parsed HTML by default. With `showSourceToggle`
 *   the user can flip to a highlighted raw-source view.
 * - Code files render as highlighted source. No toggle.
 * - Plain text files render escaped in a `<pre>`.
 * - Binary files render the binary placeholder.
 */
import type { Component } from 'solid-js';
import { Show, createEffect, createMemo, createResource, createSignal } from 'solid-js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { EmptyState } from './EmptyState.js';
import { SegmentedControl } from './SegmentedControl.js';
import type { Segment } from './SegmentedControl.js';
import {
  escapeHtml,
  highlightCode,
  highlightCodeBlocksIn,
  langFromName,
  parseMarkdown,
} from '@/utils/markdown.js';
import styles from './FileContentView.module.css';

export interface FileContentViewProps {
  /** File content. `null` indicates the file is binary or unreadable. */
  content: string | null;
  /** Filename (used for extension → language inference). */
  filename?: string;
  /** Explicit language hint; wins over filename inference. */
  lang?: string | null;
  /** Caller-detected binary marker. Renders the binary placeholder when true. */
  binary?: boolean;
  /** Optional banner shown above content (e.g. truncation notice). */
  banner?: string;
  /** Show the inner Preview/Source toggle for markdown files. Default true. */
  showSourceToggle?: boolean;
  /** Initial mode for the inner toggle. Default 'preview'. */
  initialMode?: 'preview' | 'source';
}

const HIGHLIGHT_CHAR_LIMIT = 50_000;

type ViewMode = 'preview' | 'source';

const TOGGLE_SEGMENTS: Segment<ViewMode>[] = [
  { id: 'preview', label: 'Preview' },
  { id: 'source', label: 'Source' },
];

export const FileContentView: Component<FileContentViewProps> = (props) => {
  const [mode, setMode] = createSignal<ViewMode>(props.initialMode ?? 'preview');

  const inferredLang = createMemo<string | null>(() => {
    if (props.lang !== undefined) return props.lang ?? null;
    if (props.filename) return langFromName(props.filename);
    return null;
  });

  const isMarkdown = () => inferredLang() === 'markdown';
  const showToggle = () =>
    (props.showSourceToggle ?? true) &&
    isMarkdown() &&
    !props.binary &&
    props.content !== null &&
    props.content !== '';

  const [highlighted] = createResource(
    () => {
      if (props.binary || props.content == null) return null;
      const lang = inferredLang();
      const showAsSource = isMarkdown() && mode() === 'source';
      // Highlight when: non-markdown known lang, OR markdown with source mode.
      if (isMarkdown() && !showAsSource) return null;
      if (!isMarkdown() && !lang) return null;
      return { content: props.content, lang };
    },
    async (params) => {
      if (!params) return null;
      if (params.content.length > HIGHLIGHT_CHAR_LIMIT) return null;
      return highlightCode(params.content, params.lang);
    },
  );

  const markdownHtml = createMemo(() => {
    if (!isMarkdown() || mode() !== 'preview' || !props.content) return '';
    return parseMarkdown(props.content);
  });

  let markdownEl: HTMLDivElement | undefined;
  createEffect(() => {
    // Subscribe to markdownHtml so this effect re-runs whenever the rendered
    // HTML changes (file switch, edit-then-read). Solid sets innerHTML before
    // effects run, so by this point the DOM contains the new <pre><code> nodes.
    const html = markdownHtml();
    if (!html || !markdownEl) return;
    void highlightCodeBlocksIn(markdownEl);
  });

  return (
    <div class={styles.root}>
      <Show when={props.binary}>
        <div class={styles.binaryMsg}>Binary file — cannot preview.</div>
      </Show>

      <Show when={!props.binary && props.content === null}>
        <div class={styles.center}>
          <EmptyState
            iconName="file-text"
            title="Empty file"
            description="No content to display."
          />
        </div>
      </Show>

      <Show when={!props.binary && props.content !== null}>
        <Show when={props.banner}>
          <div class={styles.banner}>{props.banner}</div>
        </Show>

        <Show when={showToggle()}>
          <div class={styles.toggleRow}>
            <SegmentedControl
              segments={TOGGLE_SEGMENTS}
              value={mode()}
              onChange={setMode}
              size="sm"
              ariaLabel="View mode"
            />
          </div>
        </Show>

        <Show
          when={isMarkdown() && mode() === 'preview'}
          fallback={
            <pre class={styles.pre}>
              <Show
                when={highlighted.loading}
                fallback={
                  <code
                    innerHTML={highlighted() ?? escapeHtml(props.content ?? '')}
                  />
                }
              >
                <span class={styles.center}>
                  <LoadingSpinner size="sm" />
                </span>
              </Show>
            </pre>
          }
        >
          <Show
            when={props.content}
            fallback={
              <div class={styles.center}>
                <EmptyState
                  iconName="file-text"
                  title="Empty file"
                  description="No content to display."
                />
              </div>
            }
          >
            <div
              ref={markdownEl}
              class={styles.markdown}
              innerHTML={markdownHtml()}
            />
          </Show>
        </Show>
      </Show>
    </div>
  );
};
