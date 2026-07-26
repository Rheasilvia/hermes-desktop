import type { Component } from 'solid-js';
import styles from './Avatar.module.css';

interface AvatarProps {
  initials: string;
  size?: number;
  bgColor?: string;
  textColor?: string;
}

export const Avatar: Component<AvatarProps> = (props) => {
  const size = () => props.size ?? 28;
  const style = () => ({
    width: `${size()}px`,
    height: `${size()}px`,
    'font-size': `${size() * 0.5}px`,
    ...(props.bgColor ? { 'background-color': props.bgColor } : {}),
    ...(props.textColor ? { color: props.textColor } : {}),
  });

  return (
    <div class={styles.avatar} style={style()}>
      {props.initials}
    </div>
  );
};
