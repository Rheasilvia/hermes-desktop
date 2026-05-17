import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { HERMES_ASCII } from '@/lib/load-ascii';
import styles from './AsciiBanner.module.css';

interface AsciiBannerProps {
  class?: string;
}

export const AsciiBanner: Component<AsciiBannerProps> = (props) => {
  return (
    <pre class={`${styles.banner} ${props.class ?? ''}`} aria-label="Hermes ASCII art">
      <For each={HERMES_ASCII}>
        {(line, i) => (
          <span class={styles.line} style={{ 'animation-delay': `${i() * 150}ms` }}>
            {line}
          </span>
        )}
      </For>
    </pre>
  );
};
