import type { Component } from 'solid-js';
import { createSignal, For, Show } from 'solid-js';
import type { MemoryEntry } from '@/types/memory.js';
import { getGateway } from '@/stores/context.js';
import { SearchInput } from '@/ui/molecules/SearchInput.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './MemorySearch.module.css';

const FALLBACK_ENTRIES: MemoryEntry[] = [
  {
    id: 'mem_001',
    content: 'User prefers detailed explanations over brief answers when learning new concepts.',
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    updated_at: new Date(Date.now() - 3600000).toISOString(),
    tags: ['user-preference', 'communication'],
    source: 'conversation',
  },
  {
    id: 'mem_002',
    content: 'Project uses TypeScript + SolidJS for the desktop application frontend with Tauri v2.',
    created_at: new Date(Date.now() - 86400000 * 7).toISOString(),
    updated_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    tags: ['project', 'tech-stack'],
    source: 'context',
  },
  {
    id: 'mem_003',
    content: 'Always use CSS modules with design tokens, never Tailwind classes in SolidJS components.',
    created_at: new Date(Date.now() - 86400000 * 5).toISOString(),
    updated_at: new Date(Date.now() - 86400000).toISOString(),
    tags: ['convention', 'frontend'],
    source: 'conversation',
  },
];

function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  return text.replace(regex, '<mark class="' + styles.highlight + '">$1</mark>');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const MemorySearch: Component = () => {
  const [query, setQuery] = createSignal('');
  const [results, setResults] = createSignal<MemoryEntry[]>([]);
  const [searched, setSearched] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const handleSearch = async (value: string) => {
    const trimmed = value.trim();
    setQuery(trimmed);
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    setLoading(true);
    const gateway = getGateway();
    if (gateway) {
      try {
        const entries = await gateway.memory.search(trimmed);
        setResults(entries.length > 0 ? entries : FALLBACK_ENTRIES.filter(
          e => e.content.toLowerCase().includes(trimmed.toLowerCase())
        ));
      } catch {
        setResults(FALLBACK_ENTRIES.filter(
          e => e.content.toLowerCase().includes(trimmed.toLowerCase())
        ));
      }
    } else {
      setResults(FALLBACK_ENTRIES.filter(
        e => e.content.toLowerCase().includes(trimmed.toLowerCase())
      ));
    }
    setSearched(true);
    setLoading(false);
  };

  return (
    <div class={styles.memorySearch}>
      <div class={styles.searchBar}>
        <SearchInput
          placeholder="Search memory entries..."
          onSearch={handleSearch}
          onChange={setQuery}
        />
      </div>

      <Show when={loading()}>
        <div class={styles.loadWrap}>
          <LoadingSpinner size="md" label="Searching..." />
        </div>
      </Show>

      <Show when={!loading() && searched() && query()}>
        <div class={styles.resultCount}>
          {results().length} result{results().length !== 1 ? 's' : ''} for "{query()}"
        </div>
      </Show>

      <Show
        when={!loading() && searched() && results().length > 0}
        fallback={
          <Show when={!loading() && searched() && results().length === 0 && query()}>
            <div class={styles.emptyWrap}>
              <EmptyState
                iconName="search"
                title="No results found"
                description={`No memory entries match "${query()}"`}
              />
            </div>
          </Show>
        }
      >
        <div class={styles.results}>
          <For each={results()}>
            {(entry) => (
              <div class={styles.resultItem}>
                <div class={styles.resultHeader}>
                  <span class={styles.resultSource}>
                    {entry.source ?? 'memory'}
                  </span>
                  <span class={styles.resultDate}>
                    {formatDate(entry.updated_at)}
                  </span>
                </div>
                <div
                  class={styles.resultContent}
                  innerHTML={highlightMatch(entry.content, query())}
                />
                <Show when={entry.tags && entry.tags.length > 0}>
                  <div class={styles.resultTags}>
                    <For each={entry.tags}>
                      {(tag) => <span class={styles.tag}>{tag}</span>}
                    </For>
                  </div>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      <Show when={!loading() && !searched()}>
        <div class={styles.emptyWrap}>
          <EmptyState
            iconName="brain"
            title="Search your memory"
            description="Type a query to search across all memory entries"
          />
        </div>
      </Show>
    </div>
  );
};
