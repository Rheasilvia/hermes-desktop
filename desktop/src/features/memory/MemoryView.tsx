import type { Component } from 'solid-js';
import { createSignal, onMount, Switch, Match, For, Show } from 'solid-js';
import type { ContextFile } from '@/types/memory.js';
import { getGateway } from '@/stores/context.js';
import { Tabs } from '@/ui/molecules/Tabs.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Badge } from '@/ui/atoms/Badge.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { MemoryContent } from './MemoryContent.js';
import { MemorySearch } from './MemorySearch.js';
import { TokenBudget } from './TokenBudget.js';
import { ProfileView } from './ProfileView.js';
import styles from './MemoryView.module.css';

const MEMORY_TABS = [
  { id: 'memory', label: 'Memory', iconName: 'brain' as const },
  { id: 'search', label: 'Search', iconName: 'search' as const },
  { id: 'context', label: 'Context', iconName: 'file-text' as const },
  { id: 'profile', label: 'Profile', iconName: 'user' as const },
];

const FALLBACK_CONTEXT_FILES: ContextFile[] = [
  {
    path: '/home/user/project/AGENTS.md',
    content: '# Project Agent Instructions\n\nThis project uses the gateway adapter pattern.',
    encoding: 'utf-8',
    size_bytes: 256,
    last_modified: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    path: '/home/user/project/.hermes/context.md',
    content: '# Project Context\n\nAdditional context for the agent.',
    encoding: 'utf-8',
    size_bytes: 128,
    last_modified: new Date(Date.now() - 7200000).toISOString(),
  },
];

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MemoryView: Component = () => {
  const [activeTab, setActiveTab] = createSignal('memory');
  const [contextFiles, setContextFiles] = createSignal<ContextFile[]>([]);
  const [loadingContext, setLoadingContext] = createSignal(false);

  onMount(async () => {
    if (activeTab() === 'context') {
      await loadContextFiles();
    }
  });

  const loadContextFiles = async () => {
    setLoadingContext(true);
    const gateway = getGateway();
    if (gateway) {
      try {
        const files = await gateway.memory.contextFiles();
        setContextFiles(files.length > 0 ? files : FALLBACK_CONTEXT_FILES);
      } catch {
        setContextFiles(FALLBACK_CONTEXT_FILES);
      }
    } else {
      setContextFiles(FALLBACK_CONTEXT_FILES);
    }
    setLoadingContext(false);
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'context' && contextFiles().length === 0) {
      void loadContextFiles();
    }
  };

  return (
    <div class={styles.memoryView}>
      <div class={styles.tabBar}>
        <Tabs tabs={MEMORY_TABS} activeTab={activeTab()} onChange={handleTabChange} />
      </div>

      <div class={styles.tabContent}>
        <Switch>
          <Match when={activeTab() === 'memory'}>
            <MemoryContent />
          </Match>

          <Match when={activeTab() === 'search'}>
            <MemorySearch />
          </Match>

          <Match when={activeTab() === 'context'}>
            <div class={styles.contextTab}>
              <Show
                when={!loadingContext()}
                fallback={
                  <div style={{ flex: 1, display: 'flex', 'align-items': 'center', 'justify-content': 'center' }}>
                    <LoadingSpinner size="md" label="Loading context..." />
                  </div>
                }
              >
                <div class={styles.contextBody}>
                  <TokenBudget used={87000} total={200000} />

                  <div>
                    <h3 class={styles.sectionTitle}>Context Files</h3>
                    <div class={styles.fileList}>
                      <For each={contextFiles()}>
                        {(file) => (
                          <div class={styles.fileItem}>
                            <span class={styles.fileIcon}>
                              <Icon name="file-text" size={16} strokeWidth={1.5} />
                            </span>
                            <div class={styles.fileInfo}>
                              <div class={styles.filePath}>{file.path}</div>
                              <div class={styles.fileMeta}>
                                <Show when={file.size_bytes}>
                                  <span>{formatSize(file.size_bytes ?? 0)}</span>
                                </Show>
                                <Show when={file.last_modified}>
                                  <span>{formatDate(file.last_modified ?? '')}</span>
                                </Show>
                                <Badge status="active" label="loaded" />
                              </div>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                </div>
              </Show>
            </div>
          </Match>

          <Match when={activeTab() === 'profile'}>
            <ProfileView />
          </Match>
        </Switch>
      </div>
    </div>
  );
};
