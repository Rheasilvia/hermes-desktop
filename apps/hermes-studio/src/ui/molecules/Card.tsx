import type { Component, JSX } from 'solid-js';
import styles from './Card.module.css';

export interface CardProps {
  children: JSX.Element;
  header?: JSX.Element;
  footer?: JSX.Element;
  padding?: 'sm' | 'md' | 'lg' | 'none';
  shadow?: 'sm' | 'md' | 'lg';
}

export const Card: Component<CardProps> = (props) => {
  const padding = () => props.padding ?? 'md';
  const shadow = () => props.shadow ?? 'md';

  const classList = () => {
    const classes = [styles.card];
    classes.push(styles[`padding-${padding()}`]);
    classes.push(styles[`shadow-${shadow()}`]);
    return classes.join(' ');
  };

  return (
    <div class={classList()}>
      {props.header && (
        <div class={styles.header}>
          {props.header}
        </div>
      )}
      <div class={styles.body}>
        {props.children}
      </div>
      {props.footer && (
        <div class={styles.footer}>
          {props.footer}
        </div>
      )}
    </div>
  );
};
