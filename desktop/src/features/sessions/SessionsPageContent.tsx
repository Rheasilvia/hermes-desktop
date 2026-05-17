import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { sessionStore } from '@/stores/session.js';
import { SessionListView } from '@/features/sessions/SessionListView.js';
import { SessionDetail } from '@/features/sessions/SessionDetail.js';
import { NewSessionModal } from '@/features/sessions/NewSessionModal.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import { ROUTES } from '@/routes.js';
import styles from './SessionsPageContent.module.css';

export const SessionsPageContent: Component = () => {
  const navigate = useNavigate();
  const [showNewModal, setShowNewModal] = createSignal(false);

  const handleSelectSession = (id: string) => {
    sessionStore.setActiveSession(id);
  };

  const handleNewSession = () => {
    setShowNewModal(true);
  };

  const handleCreateSession = async (params: { model?: string; system_prompt?: string }) => {
    const meta = await sessionStore.createSession(params);
    setShowNewModal(false);
    if (meta) {
      navigate(`${ROUTES.SESSIONS}/${meta.id}`);
    }
  };

  const handleBranch = (id: string) => {
    navigate(`${ROUTES.SESSIONS}/${id}`);
  };

  const handleResume = (id: string) => {
    sessionStore.setActiveSession(id);
    navigate(ROUTES.HOME);
  };

  const handleDelete = () => {
    sessionStore.setActiveSession(null);
  };

  return (
    <div class={styles.page}>
      <SessionListView
        activeSessionId={sessionStore.activeSessionId}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
      />
      <div class={styles.rightPanel}>
        <Show
          when={sessionStore.activeSessionId}
          fallback={
            <EmptyState
              iconName="clipboard-list"
              title="Select a session"
              description="Choose a session from the list to view its details, or create a new one."
            />
          }
        >
          {(id) => (
            <SessionDetail
              sessionId={id()}
              onBranch={handleBranch}
              onResume={handleResume}
              onDelete={handleDelete}
            />
          )}
        </Show>
      </div>
      <NewSessionModal
        open={showNewModal()}
        onClose={() => setShowNewModal(false)}
        onSubmit={handleCreateSession}
      />
    </div>
  );
};
