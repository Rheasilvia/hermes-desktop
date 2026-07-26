import type { Component, JSX } from 'solid-js';
import styles from './Button.module.css';

export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  fullWidth?: boolean;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  'aria-label'?: string;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  children: JSX.Element;
}

export const Button: Component<ButtonProps> = (props) => {
  const variant = () => props.variant ?? 'primary';
  const size = () => props.size ?? 'md';

  const classList = () => {
    const classes = [styles.button];
    classes.push(styles[variant()]);
    classes.push(styles[size()]);
    if (props.fullWidth) classes.push(styles.fullWidth);
    return classes.join(' ');
  };

  return (
    <button
      class={classList()}
      type={props.type ?? 'button'}
      title={props.title}
      aria-label={props['aria-label']}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
};
