import type { Component } from 'solid-js';
import { Show, createResource } from 'solid-js';
import { Portal } from 'solid-js/web';
import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceTreeNode } from '@/types/index.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { highlightCode } from '@/utils/markdown.js';
import styles from './WorkspaceFilePreview.module.css';

interface WorkspaceFileResult {
  content: string | null;
  truncated: boolean;
  binary: boolean;
  size: number;
}

interface Props {
  node: WorkspaceTreeNode;
  workspaceRoot: string;
  onClose: () => void;
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'json',
  sql: 'sql',
  css: 'css', scss: 'css', sass: 'css',
  html: 'html', htm: 'html', svelte: 'html', vue: 'html',
  md: 'markdown', mdx: 'markdown',
  rs: 'rust',
  go: 'go',
  java: 'java',
  yaml: 'yaml', yml: 'yaml',
};

function langFromName(name: string): string | null {
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  return EXT_TO_LANG[ext] ?? null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatKB(bytes: number): string {
  return (bytes / 1024).toFixed(0);
}

const HIGHLIGHT_CHAR_LIMIT = 50_000;

export const WorkspaceFilePreview: Component<Props> = (props) => {
  const lang = () => langFromName(props.node.name);

  const [fileResult] = createResource<WorkspaceFileResult>(() =>
    invoke('read_workspace_file', { root: props.workspaceRoot, path: props.node.path })
  );

  const [highlighted] = createResource(
    () => {
      const result = fileResult();
      if (!result?.content) return null;
      return { content: result.content, lang: lang() };
    },
    async (params) => {
      if (!params) return null;
      if (params.content.length > HIGHLIGHT_CHAR_LIMIT) return null;
      return highlightCode(params.content, params.lang);
    }
  );

  return (
    <Portal mount={document.body}>
    <Modal
      open
      title={props.node.name}
      onClose={props.onClose}
      style={{ 'max-width': '800px', width: '90vw' }}
    >
      <div class={styles.body}>
        <Show when={fileResult.loading}>
          <div class={styles.center}>
            <LoadingSpinner size="md" />
          </div>
        </Show>
        <Show when={fileResult.error}>
          <div class={styles.errorMsg}>Failed to read file: {String(fileResult.error)}</div>
        </Show>
        <Show when={fileResult() && !fileResult.loading}>
          {(_result) => {
            const result = fileResult()!;
            return (
              <>
                <Show when={result.binary}>
                  <div class={styles.infoMsg}>Binary file — cannot preview.</div>
                </Show>
                <Show when={!result.binary && result.content !== null}>
                  <Show when={result.truncated}>
                    <div class={styles.truncatedBanner}>
                      Showing first 100 KB of {formatKB(result.size)} KB file
                    </div>
                  </Show>
                  <pre class={styles.pre}>
                    <code
                      innerHTML={
                        highlighted() ?? escapeHtml(result.content!)
                      }
                    />
                  </pre>
                </Show>
              </>
            );
          }}
        </Show>
      </div>
    </Modal>
    </Portal>
  );
};
