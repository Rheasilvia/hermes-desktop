import type { Component } from 'solid-js';
import styles from './HermesAvatar.module.css';

interface HermesAvatarProps {
  size?: number;
  class?: string;
}

export const HermesAvatar: Component<HermesAvatarProps> = (props) => {
  const size = () => props.size ?? 40;
  const imgSize = () => Math.round(size() * 0.75);

  const containerStyle = () => ({
    width: `${size()}px`,
    height: `${size()}px`,
  });

  const imgStyle = () => ({
    width: `${imgSize()}px`,
    height: `${imgSize()}px`,
  });

  return (
    <div
      class={`${styles.avatar} ${props.class ?? ''}`}
      style={containerStyle()}
      aria-label="Hermes"
    >
      <img
        src="/nousresearch.svg"
        alt="Hermes"
        class={styles.img}
        style={imgStyle()}
      />
    </div>
  );
};
