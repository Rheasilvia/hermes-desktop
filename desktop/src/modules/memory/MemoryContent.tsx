import type { Component } from 'solid-js';
import { createSignal, onMount, Show } from 'solid-js';
import type { MemoryFile } from '@/types/memory.js';
import { getGateway } from '@/stores/context.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { Icon } from '@/components/Icon.js';
import styles from './MemoryContent.module.css';

const FALLBACK_MEMORY: MemoryFile = {
  path: '~/.hermes/memory/MEMORY.md',
  content: `# Memory

## User Preferences
- **Communication style**: Prefers concise, code-first responses over verbose explanations
- **Language**: Comfortable with English and Chinese
- **Editor**: Uses VS Code with Vim keybindings
- **Stack**: TypeScript, Python, Rust

## Project Context
- **hermes-agent**: Building a Tauri v2 desktop app with SolidJS frontend
- The project uses a gateway adapter pattern for IPC between UI and backend
- CSS modules with design tokens — no Tailwind
- SolidJS reactive primitives (createSignal, Show, For)

## Conventions Learned
- Always use \`class\` not \`className\` in SolidJS components
- Import paths must include \`.js\` extension for TypeScript ESM
- Use \`getGateway()\` from \`@/stores/context.js\` for dependency injection
- All styles via CSS modules — \`import styles from './Component.module.css'\`
- Design tokens via CSS custom properties: \`var(--color-primary)\`, \`var(--space-4)\`

## Working Patterns
- Agent loop in \`run_agent.py\` is synchronous, not async
- Tools register via \`registry.register()\` at import time
- Config uses YAML with versioned migrations
- Tests must use \`scripts/run_tests.sh\` for CI parity

## Environment Notes
- Development on Linux (Ubuntu/Debian)
- Tauri requires GTK system packages for Linux builds
- Python 3.11+ required, managed via uv
`,
  modified_at: new Date(Date.now() - 3600000).toISOString(),
  size_bytes: 1024,
};

export const MemoryContent: Component = () => {
  const [memoryFile, setMemoryFile] = createSignal<MemoryFile | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const files = await gateway.memory.files();
        if (files.length > 0) {
          setMemoryFile(files[0]);
        } else {
          setMemoryFile(FALLBACK_MEMORY);
        }
      } catch {
        setMemoryFile(FALLBACK_MEMORY);
      }
    } else {
      setMemoryFile(FALLBACK_MEMORY);
    }
    setLoading(false);
  });

  const htmlContent = (): string => {
    const file = memoryFile();
    if (!file) return '';
    return parseMarkdown(file.content);
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  const formatDate = (iso: string): string => {
    return new Date(iso).toLocaleString();
  };

  return (
    <div class={styles.memoryContent}>
      <Show
        when={!loading()}
        fallback={
          <div class={styles.loadWrap}>
            <LoadingSpinner size="md" label="Loading memory..." />
          </div>
        }
      >
        <Show when={memoryFile()}>
          {(file) => (
            <>
              <div
                class={styles.markdownBody}
                innerHTML={htmlContent()}
              />
              <div class={styles.meta}>
                <span class={styles.metaItem}><Icon name="file-text" size={14} /> {file().path}</span>
                <span class={styles.metaItem}><Icon name="package" size={14} /> {formatSize(file().size_bytes)}</span>
                <span class={styles.metaItem}><Icon name="clock" size={14} /> {formatDate(file().modified_at)}</span>
              </div>
            </>
          )}
        </Show>
      </Show>
    </div>
  );
};
