import { Component, JSX, Show } from 'solid-js';
import styles from './ModuleLayout.module.css';

interface ModuleLayoutProps {
  title: string;
  description?: string;
  prefix?: JSX.Element;
  actions?: JSX.Element;
  children: JSX.Element;
}

export const ModuleLayout: Component<ModuleLayoutProps> = (props) => {
  return (
    <div class={styles.moduleLayout}>
      <header class={styles.header}>
        <div class={styles.headerLeft}>
          <Show when={props.prefix}>
            <div class={styles.prefix}>{props.prefix}</div>
          </Show>
          <div class={styles.headerText}>
            <h1 class={styles.title}>{props.title}</h1>
            {props.description && <p class={styles.description}>{props.description}</p>}
          </div>
        </div>
        <Show when={props.actions}>
          <div class={styles.actions}>{props.actions}</div>
        </Show>
      </header>
      <div class={styles.content}>{props.children}</div>
    </div>
  );
};
