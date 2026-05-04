import type { Component } from 'solid-js';
import { Icon } from './Icon';
import styles from './ModuleErrorFallback.module.css';

interface ModuleErrorFallbackProps {
  moduleName: string;
  error: Error;
  onReload?: () => void;
}

export const ModuleErrorFallback: Component<ModuleErrorFallbackProps> = (props) => {
  return (
    <div class={styles.container}>
      <div class={styles.icon}>
        <Icon name="alert-circle" size={32} />
      </div>
      <h3 class={styles.title}>Something went wrong</h3>
      <p class={styles.message}>
        The {props.moduleName} module encountered an error.
      </p>
      <pre class={styles.trace}>{props.error.message}</pre>
      {props.onReload && (
        <button class={styles.retryBtn} onClick={props.onReload}>
          Try again
        </button>
      )}
    </div>
  );
};
