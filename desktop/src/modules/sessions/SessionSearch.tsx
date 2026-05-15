import type { Component } from 'solid-js';
import { createSignal, createMemo, Show, For } from 'solid-js';
import type { RenderedMessage } from '@/types/index.js';
import type { TextBlock } from '@/types/ui/blocks.js';
import { SearchInput } from '@/components/SearchInput.js';
import { EmptyState } from '@/components/EmptyState.js';
import styles from './SessionSearch.module.css';

interface SessionSearchProps {
  messages: RenderedMessage[];
}

interface SearchResult {
  message: RenderedMessage;
  index: number;
}

function getTextContent(msg: RenderedMessage): string {
  return msg.blocks
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.content)
    .join(' ');
}

export const SessionSearch: Component<SessionSearchProps> = (props) => {
  const [query, setQuery] = createSignal('');

  const results = createMemo<SearchResult[]>(() => {
    const q = query().toLowerCase().trim();
    if (!q) return [];

    return props.messages
      .map((msg, index) => ({ message: msg, index }))
      .filter((item) => {
        const content = getTextContent(item.message);
        return content.toLowerCase().includes(q);
      });
  });

  const roleLabel = (role: string): string => {
    switch (role) {
      case 'user': return 'You';
      case 'assistant': return 'Hermes';
      case 'tool': return 'Tool';
      case 'system': return 'System';
      default: return role;
    }
  };

  const roleClass = (role: string): string => {
    switch (role) {
      case 'user': return styles.roleUser;
      case 'assistant': return styles.roleAssistant;
      case 'tool': return styles.roleTool;
      default: return styles.roleSystem;
    }
  };

  return (
    <div class={styles.container}>
      <SearchInput
        placeholder="Search within messages..."
        onChange={setQuery}
        onSearch={setQuery}
      />
      <Show
        when={query().trim().length > 0}
        fallback={
          <div class={styles.hint}>
            Type a query to search through messages in this session.
          </div>
        }
      >
        <Show
          when={results().length > 0}
          fallback={
            <EmptyState
              iconName="search"
              title="No results"
              description="No messages match your search query."
            />
          }
        >
          <div class={styles.resultCount}>
            {results().length} result{results().length !== 1 ? 's' : ''}
          </div>
          <div class={styles.results}>
            <For each={results()}>
              {(result) => (
                <div class={styles.result}>
                  <div class={styles.resultHeader}>
                    <span class={`${styles.role} ${roleClass(result.message.role)}`}>
                      {roleLabel(result.message.role)}
                    </span>
                    <span class={styles.resultIndex}>#{result.index + 1}</span>
                  </div>
                  <p class={styles.resultContent}>
                    {getTextContent(result.message) || '(empty)'}
                  </p>
                </div>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};
