import type { Component } from 'solid-js';
import { createSignal, createEffect, For, Show } from 'solid-js';
import { getGateway } from '@/stores/context.js';
import { Icon } from '@/ui/atoms/Icon';
import styles from './GitBranchPicker.module.css';

interface GitBranchInfo {
  current: string;
  branches: string[];
}

interface GitBranchPickerProps {
  sessionId: string | null | undefined;
  workspacePath: string | null | undefined;
  disabled?: boolean;
}

export const GitBranchPicker: Component<GitBranchPickerProps> = (props) => {
  const [currentBranch, setCurrentBranch] = createSignal<string | null>(null);
  const [branches, setBranches] = createSignal<string[]>([]);
  const [open, setOpen] = createSignal(false);
  let pillRef: HTMLButtonElement | undefined;

  const isDisabled = () => props.disabled ?? false;

  const loadBranches = async (sessionId: string) => {
    try {
      const info = await getGateway()?.git.branches(sessionId);
      if (!info) throw new Error('Gateway is not initialized');
      setCurrentBranch(info.current || null);
      setBranches(info.branches);
    } catch {
      setCurrentBranch(null);
      setBranches([]);
    }
  };

  createEffect(() => {
    const sid = props.sessionId;
    if (!sid || !props.workspacePath) {
      setCurrentBranch(null);
      setBranches([]);
      return;
    }
    void loadBranches(sid);
  });

  const handleClick = () => {
    if (isDisabled()) return;
    setOpen(!open());
  };

  const handleSelectBranch = async (branch: string) => {
    const sid = props.sessionId;
    if (!sid) return;
    setOpen(false);
    try {
      await getGateway()?.git.checkout(sid, branch);
      setCurrentBranch(branch);
    } catch {
      // silently ignore checkout errors
    }
  };

  const handleClickOutside = (e: MouseEvent) => {
    if (!pillRef || !pillRef.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  createEffect(() => {
    if (open()) {
      document.addEventListener('click', handleClickOutside, true);
    } else {
      document.removeEventListener('click', handleClickOutside, true);
    }
  });

  return (
    <Show when={currentBranch() !== null}>
      <button
        classList={{
          [styles.pill]: true,
          [styles.pillDisabled]: isDisabled(),
        }}
        ref={(el) => { pillRef = el; }}
        onClick={handleClick}
        type="button"
        disabled={isDisabled()}
        aria-label="Switch git branch"
      >
        <Icon name="git-branch" size={10} />
        <span>{currentBranch()}</span>
        <Show when={open()}>
          <div class={styles.popover}>
            <For each={branches()}>
              {(branch) => (
                <button
                  type="button"
                  classList={{
                    [styles.branchItem]: true,
                    [styles.branchItemCurrent]: branch === currentBranch(),
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSelectBranch(branch);
                  }}
                >
                  <span
                    classList={{
                      [styles.checkIcon]: true,
                      [styles.checkIconVisible]: branch === currentBranch(),
                    }}
                  >
                    <Icon name="check" size={10} />
                  </span>
                  {branch}
                </button>
              )}
            </For>
          </div>
        </Show>
      </button>
    </Show>
  );
};
