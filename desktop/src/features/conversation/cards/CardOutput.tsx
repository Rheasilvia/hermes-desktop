import { Show, type Component } from 'solid-js';
import styles from './cards.module.css';

/**
 * Presentational archetype for CLI-text cards (logs, account, output): renders
 * the captured text as preformatted monospace (no HTML/markdown injection).
 */
export const CardOutput: Component<{ text?: string; empty?: string }> = (props) => (
  <Show
    when={(props.text ?? '').trim()}
    fallback={<p class={styles.state} role="status">{props.empty ?? 'No output.'}</p>}
  >
    <pre class={styles.output}>{props.text}</pre>
  </Show>
);
