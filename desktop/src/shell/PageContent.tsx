import type { Component, JSX } from 'solid-js';
import styles from './PageContent.module.css';

export const PageContent: Component<{ children: JSX.Element }> = (props) => (
  <div class={styles.pageContent}>{props.children}</div>
);
