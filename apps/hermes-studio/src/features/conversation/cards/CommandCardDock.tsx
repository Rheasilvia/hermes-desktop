import { onMount, type Component } from 'solid-js';
import { CommandCardRenderer, type ActiveCommandCard } from './CommandCardRenderer.js';
import styles from './cards.module.css';

/**
 * Wraps the active command card in the above-input dock. Owns the a11y
 * region + focus-on-open + Esc-to-dismiss; the card content itself is rendered
 * by CommandCardRenderer.
 */
export const CommandCardDock: Component<{
  card: ActiveCommandCard;
  embedded?: boolean;
  onDismiss: () => void;
}> = (props) => {
  let ref: HTMLDivElement | undefined;
  onMount(() => ref?.focus());

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      props.onDismiss();
    }
  };

  return (
    <div
      ref={ref}
      class={styles.dock}
      classList={{ [styles.dockEmbedded]: props.embedded }}
      role="region"
      aria-label="Command result"
      tabindex={-1}
      onKeyDown={onKeyDown}
    >
      <CommandCardRenderer card={props.card} onDismiss={props.onDismiss} />
    </div>
  );
};
