import type { Component, JSX } from 'solid-js';
import { Show } from 'solid-js';
import styles from './Tooltip.module.css';

export interface TooltipProps {
  content: string;
  children: JSX.Element;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export const Tooltip: Component<TooltipProps> = (props) => {
  const position = () => props.position ?? 'top';

  return (
    <div class={styles.tooltipWrapper}>
      {props.children}
      <span class={`${styles.tooltip} ${styles[position()]}`}>
        {props.content}
      </span>
    </div>
  );
};
