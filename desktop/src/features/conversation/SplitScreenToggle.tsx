import type { Component } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './SplitScreenToggle.module.css';

interface SplitScreenToggleProps {
  active: boolean;
  onToggle: () => void;
}

export const SplitScreenToggle: Component<SplitScreenToggleProps> = (props) => {
  return (
    <button
      type="button"
      class={`${styles.toggle} ${props.active ? styles.toggleActive : ''}`}
      onClick={props.onToggle}
      title={props.active ? 'Hide diff' : 'Show diff'}
    >
      <Icon name="git-branch" size={16} />
    </button>
  );
};
