import type { Component } from 'solid-js';
import styles from './HermesAvatar.module.css';
import svgContent from '@/assets/nousresearch.svg?raw';

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

  const innerHtml = () => {
    const px = `${imgSize()}px`;
    return svgContent.replace(
      '<svg ',
      `<svg class="${styles.img}" width="${px}" height="${px}" `,
    );
  };

  return (
    <div
      class={`${styles.avatar} ${props.class ?? ''}`}
      style={containerStyle()}
      aria-label="Hermes"
      innerHTML={innerHtml()}
    />
  );
};
