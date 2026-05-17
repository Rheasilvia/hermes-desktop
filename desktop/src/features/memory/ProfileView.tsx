import type { Component } from 'solid-js';
import { createSignal, onMount, Show } from 'solid-js';
import type { MemoryFile } from '@/types/memory.js';
import { getGateway } from '@/stores/context.js';
import { parseMarkdown } from '@/utils/markdown.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './ProfileView.module.css';

const FALLBACK_MEMORY_MD: MemoryFile = {
  path: '~/.hermes/memory/MEMORY.md',
  content: `# Memory

- User prefers concise code-first responses
- Project uses TypeScript + SolidJS + Tauri v2
- CSS modules with design tokens — no Tailwind
- Always use \`class\` not \`className\` in SolidJS`,
  modified_at: new Date(Date.now() - 3600000).toISOString(),
  size_bytes: 256,
};

const FALLBACK_USER_MD: MemoryFile = {
  path: '~/.hermes/memory/USER.md',
  content: `# User Profile

## Preferences
- **Communication**: Direct and concise
- **Languages**: English, Chinese
- **Stack**: TypeScript, Python, Rust
- **Editor**: VS Code + Vim keybindings

## Notes
- Works on Linux (Ubuntu)
- Prefers dark themes
- Values performance and correctness
`,
  modified_at: new Date(Date.now() - 7200000).toISOString(),
  size_bytes: 384,
};

export const ProfileView: Component = () => {
  const [memoryMd, setMemoryMd] = createSignal<MemoryFile | null>(null);
  const [userMd, setUserMd] = createSignal<MemoryFile | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const files = await gateway.memory.files();
        const memory = files.find(f => f.path.includes('MEMORY.md'));
        const user = files.find(f => f.path.includes('USER.md'));
        setMemoryMd(memory ?? FALLBACK_MEMORY_MD);
        setUserMd(user ?? FALLBACK_USER_MD);
      } catch {
        setMemoryMd(FALLBACK_MEMORY_MD);
        setUserMd(FALLBACK_USER_MD);
      }
    } else {
      setMemoryMd(FALLBACK_MEMORY_MD);
      setUserMd(FALLBACK_USER_MD);
    }
    setLoading(false);
  });

  const memoryHtml = (): string => {
    const file = memoryMd();
    return file ? parseMarkdown(file.content) : '';
  };

  const userHtml = (): string => {
    const file = userMd();
    return file ? parseMarkdown(file.content) : '';
  };

  return (
    <div class={styles.profileView}>
      <Show
        when={!loading()}
        fallback={
          <div class={styles.loadWrap}>
            <LoadingSpinner size="md" label="Loading profile..." />
          </div>
        }
      >
        <div class={styles.profileHeader}>
          <div class={styles.avatar}>U</div>
          <div class={styles.profileInfo}>
            <p class={styles.profileName}>Hermes User</p>
            <p class={styles.profileEmail}>~/.hermes/profiles/default</p>
          </div>
        </div>

        <div class={styles.sections}>
          <Show when={userMd()}>
            <div class={styles.section}>
              <div class={styles.sectionHeader}>
                <Icon name="user" size={16} /> USER.md
              </div>
              <div class={styles.sectionBody}>
                <div
                  class={styles.markdownContent}
                  innerHTML={userHtml()}
                />
              </div>
            </div>
          </Show>

          <Show when={memoryMd()}>
            <div class={styles.section}>
              <div class={styles.sectionHeader}>
                <Icon name="brain" size={16} /> MEMORY.md
              </div>
              <div class={styles.sectionBody}>
                <div
                  class={styles.markdownContent}
                  innerHTML={memoryHtml()}
                />
              </div>
            </div>
          </Show>
        </div>

        <div class={styles.metadata}>
          <span class={styles.metaTag}>Profile: default</span>
          <Show when={memoryMd()}>
            <span class={styles.metaTag}>MEMORY.md</span>
          </Show>
          <Show when={userMd()}>
            <span class={styles.metaTag}>USER.md</span>
          </Show>
        </div>
      </Show>
    </div>
  );
};
