import type { Component } from 'solid-js';
import { createSignal, createMemo, createEffect, onMount, Show, For } from 'solid-js';
import { sessionStore } from '@/stores/session.js';
import { SearchInput } from '@/ui/molecules/SearchInput.js';
import { Select } from '@/ui/atoms/Select.js';
import { Button } from '@/ui/atoms/Button.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { SessionCard } from './SessionCard.js';
import type { Tab } from '@/ui/molecules/Tabs.js';
import styles from './SessionListView.module.css';

type FilterOption = 'all' | 'today' | 'week' | 'starred';

interface SessionListViewProps {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
}

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'starred', label: 'Starred' },
];

function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.toDateString() === now.toDateString();
}

function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  weekStart.setHours(0, 0, 0, 0);
  return d >= weekStart;
}

export const SessionListView: Component<SessionListViewProps> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [filter, setFilter] = createSignal<FilterOption>('all');

  onMount(() => {
    void sessionStore.loadSessions();
  });

  const filteredSessions = createMemo(() => {
    let list = sessionStore.sessions;

    const query = searchQuery().toLowerCase().trim();
    if (query) {
      list = list.filter(
        (s) =>
          s.title.toLowerCase().includes(query) ||
          s.model.toLowerCase().includes(query) ||
          (s.last_message ?? '').toLowerCase().includes(query),
      );
    }

    const f = filter();
    if (f === 'today') {
      list = list.filter((s) => isToday(s.started_at));
    } else if (f === 'week') {
      list = list.filter((s) => isThisWeek(s.started_at));
    } else if (f === 'starred') {
      list = [];
    }

    return list;
  });

  return (
    <div class={styles.panel}>
      <div class={styles.header}>
        <h2 class={styles.heading}>Sessions</h2>
        <Button variant="primary" size="sm" onClick={props.onNewSession}>
          + New
        </Button>
      </div>

      <div class={styles.toolbar}>
        <SearchInput
          placeholder="Search sessions..."
          onChange={setSearchQuery}
          onSearch={setSearchQuery}
        />
        <Select
          options={FILTER_OPTIONS}
          value={filter()}
          onChange={(v) => setFilter(v as FilterOption)}
        />
      </div>

      <Show when={sessionStore.isLoading} fallback={null}>
        <div class={styles.loading}>
          <LoadingSpinner size="sm" label="Loading..." />
        </div>
      </Show>

      <div class={styles.list}>
        <Show
          when={filteredSessions().length > 0}
          fallback={
            <EmptyState
              iconName="clipboard-list"
              title="No sessions"
              description={
                searchQuery() || filter() !== 'all'
                  ? 'No sessions match your search.'
                  : 'Start a new conversation to see it here.'
              }
            />
          }
        >
          <For each={filteredSessions()}>
            {(session) => (
              <SessionCard
                session={session}
                isActive={session.id === props.activeSessionId}
                onSelect={props.onSelectSession}
              />
            )}
          </For>
        </Show>
      </div>
    </div>
  );
};
