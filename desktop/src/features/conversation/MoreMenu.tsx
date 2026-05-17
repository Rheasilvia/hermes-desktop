import type { Component } from 'solid-js';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './MoreMenu.module.css';

interface MoreMenuProps {
  diffOpen: boolean;
  onToggleDiff: () => void;
}

export const MoreMenu: Component<MoreMenuProps> = (props) => {
  const [isOpen, setIsOpen] = createSignal(false);
  let wrapperRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (wrapperRef && !wrapperRef.contains(e.target as Node)) {
      setIsOpen(false);
    }
  };

  onMount(() => {
    document.addEventListener('click', handleClickOutside, true);
  });

  onCleanup(() => {
    document.removeEventListener('click', handleClickOutside, true);
  });

  return (
    <div class={styles.wrapper} ref={wrapperRef}>
      <button
        type="button"
        class={styles.trigger}
        onClick={() => setIsOpen(!isOpen())}
        title="More options"
      >
        <Icon name="more-horizontal" size={16} />
      </button>
      {isOpen() && (
        <div class={styles.dropdown}>
          <button
            type="button"
            class={styles.dropdownItem}
            onClick={() => {
              props.onToggleDiff();
              setIsOpen(false);
            }}
          >
            <Icon name="git-branch" size={14} />
            <span>{props.diffOpen ? 'Hide Diff' : 'View Diff'}</span>
          </button>
        </div>
      )}
    </div>
  );
};
