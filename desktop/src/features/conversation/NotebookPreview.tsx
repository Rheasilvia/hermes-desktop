import type { Component } from 'solid-js';
import { For, Match, Show, Switch, createEffect, createMemo, on, onCleanup, untrack } from 'solid-js';
import type { NotebookCell, NotebookOutput } from '@/services/gateway/types.js';
import type { NotebookPreviewTarget } from '@/stores/preview.js';
import { notebookPreviewStore } from '@/stores/notebook-preview.js';
import { sanitizeHtml, highlightCodeBlocksIn } from '@/utils/markdown.js';
import { MarkdownContent } from '@/ui/molecules/MarkdownContent.js';
import { CodeBlock } from './CodeBlock.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './NotebookPreview.module.css';

interface NotebookPreviewProps {
  sessionId: string;
  target: NotebookPreviewTarget;
}

const ExecutionCount: Component<{ count: number | null | undefined }> = (props) => (
  <Show when={props.count != null}>
    <span class={styles.execCount} aria-label={`Execution count ${props.count}`}>[{props.count}]</span>
  </Show>
);

/** Renders one cell output by mime type. Image/HTML/markdown/text/error. */
const CellOutput: Component<{ output: NotebookOutput }> = (props) => {
  const out = () => props.output;
  return (
    <div class={styles.output} data-output-type={out().output_type}>
      <Show when={out().image}>
        {/* CSP allows img-src data: — base64 inline notebook images */}
        <img class={styles.outputImage} src={out().image!} alt="Notebook output image" loading="lazy" />
      </Show>
      <Show when={out().html}>
        <HtmlOutput html={out().html!} />
      </Show>
      <Show when={out().markdown}>
        <MarkdownContent content={out().markdown!} variant="document" class={styles.outputMarkdown} />
      </Show>
      <Show when={out().text && !out().html && !out().markdown && !out().image}>
        <pre class={styles.outputText}><code>{out().text}</code></pre>
      </Show>
      <Show when={out().output_type === 'error'}>
        <pre class={styles.outputError}>
          <code>{[out().error_name, out().error_value].filter(Boolean).join(': ')}</code>
          <Show when={out().error_traceback?.length}>
            {'\n'}{out().error_traceback?.join('\n')}
          </Show>
        </pre>
      </Show>
    </div>
  );
};

/** Sanitizes nbformat text/html output via DOMPurify before injecting. */
const HtmlOutput: Component<{ html: string }> = (props) => {
  let rootRef: HTMLDivElement | undefined;
  const safe = createMemo(() => sanitizeHtml(props.html));
  createEffect(() => {
    if (!rootRef) return;
    void highlightCodeBlocksIn(rootRef);
  });
  return <div ref={(el) => { rootRef = el; }} class={styles.outputHtml} innerHTML={safe()} />;
};

/** One notebook cell: markdown renders inline; code shows source + outputs. */
const Cell: Component<{ cell: NotebookCell }> = (props) => {
  const cell = () => props.cell;
  return (
    <Show when={cell().cell_type === 'markdown' || cell().cell_type === 'code' || cell().cell_type === 'raw'}>
      <article class={styles.cell} data-cell-type={cell().cell_type}>
        <Show when={cell().cell_type === 'markdown'}>
          <MarkdownContent content={cell().source} variant="document" />
        </Show>
        <Show when={cell().cell_type === 'code'}>
          <div class={styles.codeCell}>
            <div class={styles.codeSource}>
              <CodeBlock content={cell().source} language="python" />
            </div>
            <Show when={cell().outputs?.length}>
              <div class={styles.outputs}>
                <For each={cell().outputs}>{(output) => <CellOutput output={output} />}</For>
              </div>
            </Show>
          </div>
          <div class={styles.cellFooter}>
            <ExecutionCount count={cell().execution_count} />
          </div>
        </Show>
        <Show when={cell().cell_type === 'raw'}>
          <pre class={styles.rawCell}><code>{cell().source}</code></pre>
        </Show>
      </article>
    </Show>
  );
};

export const NotebookPreview: Component<NotebookPreviewProps> = (props) => {
  const state = createMemo(() => notebookPreviewStore.getState(props.sessionId));
  // Derived view-state — single source of truth for which branch renders.
  // Computed once per state change; avoids the nested-Show oscillation that
  // ambiguous (error && empty) conditions can cause.
  const view = createMemo<'loading' | 'error' | 'empty' | 'cells'>(() => {
    const s = state();
    if (s.error) return 'error';
    if (s.loading) return 'loading';
    if (s.cells.length === 0) return 'empty';
    return 'cells';
  });

  // (Re)load ONLY when path/session changes — never re-run on render-state
  // changes (which would create a load→setState→re-render loop). `on(...)` pins
  // this effect to its explicit dependencies; `untrack` ensures the async store
  // mutation doesn't get wired as a dependency.
  createEffect(on(
    () => [props.target.path, props.sessionId] as const,
    ([path, sessionId]) => {
      if (path && sessionId) {
        void untrack(() => notebookPreviewStore.load(sessionId, path));
      }
    },
  ));

  onCleanup(() => {
    // Best-effort: stop watching when the preview unmounts.
    void notebookPreviewStore.clear(props.sessionId);
  });

  return (
    <div class={styles.pageChrome}>
      <header class={styles.header}>
        <span class={styles.headerIcon}><Icon name="file-text" size={14} /></span>
        <span class={styles.title} title={props.target.path}>{props.target.label}</span>
      </header>
      <Switch>
        <Match when={view() === 'loading'}>
          <div class={styles.loading} role="status" aria-label="Loading notebook">
            <Icon name="loader" size={20} />
            <span>Rendering notebook…</span>
          </div>
        </Match>
        <Match when={view() === 'error'}>
          <div class={styles.error} role="alert" aria-label="Notebook render failed">
            <span class={styles.emptyIcon}><Icon name="alert-triangle" size={24} /></span>
            <div class={styles.emptyTitle}>Couldn’t render notebook</div>
            <div class={styles.emptyDescription}>{state().error}</div>
          </div>
        </Match>
        <Match when={view() === 'empty'}>
          <div class={styles.empty} role="status" aria-label="Empty notebook">
            <span class={styles.emptyIcon}><Icon name="file-text" size={24} /></span>
            <div class={styles.emptyTitle}>No cells to display</div>
            <div class={styles.emptyDescription}>This notebook has no renderable cells.</div>
          </div>
        </Match>
        <Match when={view() === 'cells'}>
          <div class={styles.cells}>
            <For each={state().cells}>{(cell) => <Cell cell={cell} />}</For>
            <div class={styles.footer}>
              <span>{state().cells.length} cells</span>
              <Show when={state().mtime > 0}>
                <span class={styles.updated}>updated {new Date(state().mtime * 1000).toLocaleTimeString()}</span>
              </Show>
            </div>
          </div>
        </Match>
      </Switch>
    </div>
  );
};
