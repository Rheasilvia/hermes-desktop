import type { Component } from 'solid-js';
import { createSignal, Show } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { Icon } from '@/components/Icon.js';
import { AsciiBanner } from '@/components/AsciiBanner.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { sessionStore } from '@/stores/session.js';
import styles from './WelcomeView.module.css';

export const WelcomeView: Component = () => {
  const navigate = useNavigate();
  const [workspacePath, setWorkspacePath] = createSignal<string | null>(null);
  const [isCreating, setIsCreating] = createSignal(false);

  const handleSelectWorkspace = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        directory: true,
        title: 'Select Workspace',
      });
      if (selected && typeof selected === 'string') {
        setWorkspacePath(selected);
        // Auto-create session with selected workspace
        setIsCreating(true);
        try {
          const meta = await sessionStore.createSession({ workspace_path: selected });
          if (meta) {
            navigate(`/conversation/${meta.id}`);
          }
        } finally {
          setIsCreating(false);
        }
      }
    } catch {
      // dialog plugin may not be available — silently ignore
    }
  };

  return (
    <div class={styles.welcome}>
      <div class={styles.content}>
        <Show
          when={!isCreating()}
          fallback={
            <div class={styles.loadingState}>
              <LoadingSpinner size="lg" />
              <p class={styles.loadingText}>Creating conversation...</p>
              <p class={styles.loadingPath}>{workspacePath()}</p>
            </div>
          }
        >
          <AsciiBanner class={styles.banner} />
          <h1 class={styles.title}>Welcome to Hermes</h1>
          <p class={styles.description}>
            Select a workspace — the project folder Hermes will work in.
          </p>

          <button
            type="button"
            class={styles.selectBtn}
            onClick={handleSelectWorkspace}
          >
            <Icon name="folder-open" size={16} />
            <span>Choose folder...</span>
          </button>
        </Show>
      </div>
    </div>
  );
};
