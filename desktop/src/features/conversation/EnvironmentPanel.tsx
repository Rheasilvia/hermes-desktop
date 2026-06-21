import type { Component } from 'solid-js';
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { gitViewStore } from '@/stores/git-view.js';
import { sidePanelStore } from '@/stores/side-panel.js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './EnvironmentPanel.module.css';

interface EnvironmentPanelProps {
  sessionId: string | null;
  workspacePath: string | null;
}

export const EnvironmentPanel: Component<EnvironmentPanelProps> = (props) => {
  const [currentBranch, setCurrentBranch] = createSignal<string | null>(null);
  const [branches, setBranches] = createSignal<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = createSignal(false);
  const [branchLoading, setBranchLoading] = createSignal(false);
  const [branchError, setBranchError] = createSignal<string | null>(null);
  let branchRoot: HTMLDivElement | undefined;

  const workspaceName = createMemo(() => {
    const path = props.workspacePath;
    if (!path) return 'No workspace';
    const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/');
    return normalized.split('/').filter(Boolean).pop() ?? path;
  });

  const diffSummary = createMemo(() => gitViewStore.diffData()?.summary ?? null);
  const hasWorkspace = createMemo(() => Boolean(props.sessionId && props.workspacePath));
  const branchLabel = createMemo(() => {
    if (branchLoading()) return 'Loading branch';
    return currentBranch() ?? 'No branch';
  });

  const loadBranches = async (sessionId: string) => {
    setBranchLoading(true);
    setBranchError(null);
    try {
      const info = await getGateway()?.git.branches(sessionId);
      if (!info) throw new Error('Gateway is not initialized');
      setCurrentBranch(info.current || null);
      setBranches(info.branches);
    } catch (error) {
      setCurrentBranch(null);
      setBranches([]);
      setBranchError(error instanceof Error ? error.message : 'Could not load branches');
    } finally {
      setBranchLoading(false);
    }
  };

  createEffect(() => {
    const sessionId = props.sessionId;
    const workspacePath = props.workspacePath;
    setBranchMenuOpen(false);
    if (!sessionId || !workspacePath) {
      setCurrentBranch(null);
      setBranches([]);
      setBranchError(null);
      return;
    }
    void gitViewStore.fetchDiff();
    void loadBranches(sessionId);
  });

  createEffect(() => {
    if (!branchMenuOpen()) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && branchRoot?.contains(target)) return;
      setBranchMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  const openReview = () => sidePanelStore.openTab('review');
  const openFiles = () => sidePanelStore.openTab('files');
  const requestAddTool = () => {
    sidePanelStore.open();
    sidePanelStore.requestToolMenuOpen();
  };

  const toggleBranchMenu = () => {
    if (!hasWorkspace() || branches().length === 0) return;
    setBranchMenuOpen((open) => !open);
  };

  const selectBranch = async (branch: string) => {
    const sessionId = props.sessionId;
    if (!sessionId) return;
    setBranchMenuOpen(false);
    setBranchError(null);
    try {
      const gateway = getGateway();
      if (!gateway) throw new Error('Gateway is not initialized');
      await gateway.git.checkout(sessionId, branch);
      setCurrentBranch(branch);
      await loadBranches(sessionId);
      await gitViewStore.fetchDiff();
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : 'Could not switch branches');
    }
  };

  return (
    <section class={styles.shell} aria-label="Environment panel">
      <div class={styles.card}>
        <header class={styles.header}>
          <h2 class={styles.title}>Environment</h2>
          <button
            type="button"
            class={styles.addButton}
            aria-label="Add environment tool"
            title="Add tool tab"
            onClick={requestAddTool}
          >
            <Icon name="plus" size={16} strokeWidth={1.7} />
          </button>
        </header>

        <div class={styles.rows}>
          <button type="button" class={styles.row} onClick={openReview} aria-label="Open git changes">
            <span class={styles.iconSlot}><Icon name="clipboard-list" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Changes</span>
            </span>
            <span class={styles.changeStats} aria-label="Change summary">
              <Show when={diffSummary()} fallback={<span class={styles.mutedValue}>No diff</span>}>
                {(summary) => (
                  <>
                    <span class={styles.insertions}>+{summary().insertions.toLocaleString()}</span>
                    <span class={styles.deletions}>-{summary().deletions.toLocaleString()}</span>
                  </>
                )}
              </Show>
            </span>
          </button>

          <button type="button" class={styles.row} onClick={openFiles} aria-label="Open local workspace">
            <span class={styles.iconSlot}><Icon name="monitor" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Local</span>
              <span class={styles.rowSubtitle} title={props.workspacePath ?? undefined}>{workspaceName()}</span>
            </span>
            <Icon name="chevron-right" size={14} class={styles.trailingIcon} />
          </button>

          <div class={styles.branchRoot} ref={(el) => { branchRoot = el; }}>
            <button
              type="button"
              class={styles.row}
              classList={{ [styles.rowDisabled]: !hasWorkspace() || branches().length === 0 }}
              disabled={!hasWorkspace() || branches().length === 0}
              onClick={toggleBranchMenu}
              aria-label="Switch git branch"
              aria-haspopup="menu"
              aria-expanded={branchMenuOpen()}
            >
              <span class={styles.iconSlot}><Icon name="git-branch" size={16} strokeWidth={1.7} /></span>
              <span class={styles.rowText}>
                <span class={styles.rowTitle}>{branchLabel()}</span>
                <Show when={branchError()}>
                  <span class={styles.rowSubtitle}>{branchError()}</span>
                </Show>
              </span>
              <Icon name="chevron-down" size={14} class={styles.trailingIcon} />
            </button>
            <Show when={branchMenuOpen()}>
              <div class={styles.branchMenu} role="menu" aria-label="Git branches">
                <For each={branches()}>
                  {(branch) => (
                    <button
                      type="button"
                      class={styles.branchItem}
                      classList={{ [styles.branchItemCurrent]: branch === currentBranch() }}
                      role="menuitem"
                      onClick={() => void selectBranch(branch)}
                    >
                      <span
                        class={styles.checkSlot}
                        classList={{ [styles.checkSlotVisible]: branch === currentBranch() }}
                      >
                        <Icon name="check" size={12} strokeWidth={2} />
                      </span>
                      <span class={styles.branchName}>{branch}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          <button
            type="button"
            class={`${styles.row} ${styles.rowDisabled}`}
            disabled
            aria-label="Commit or push unavailable"
          >
            <span class={styles.iconSlot}><Icon name="git-pull-request" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>Commit or push</span>
            </span>
          </button>

          <button
            type="button"
            class={`${styles.row} ${styles.rowDisabled}`}
            disabled
            aria-label="GitHub CLI unavailable"
          >
            <span class={styles.iconSlot}><Icon name="terminal" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>GitHub CLI unavailable</span>
            </span>
          </button>
        </div>

        <div class={styles.divider} />

        <section class={styles.sourcesSection} aria-label="Sources">
          <h3 class={styles.sectionTitle}>Sources</h3>
          <button type="button" class={styles.row} onClick={openFiles} aria-label="Open source workspace">
            <span class={styles.iconSlot}><Icon name="code" size={16} strokeWidth={1.7} /></span>
            <span class={styles.rowText}>
              <span class={styles.rowTitle}>{workspaceName()}</span>
              <span class={styles.rowSubtitle} title={props.workspacePath ?? undefined}>
                {props.workspacePath ?? 'No workspace selected'}
              </span>
            </span>
            <Icon name="chevron-right" size={14} class={styles.trailingIcon} />
          </button>
        </section>
      </div>
    </section>
  );
};
