import type { Component } from 'solid-js';
import styles from './HermesLogo.module.css';
import svgContent from '@/assets/hermes-logo.svg?raw';

interface HermesLogoProps {
  class?: string;
}

export const HermesLogo: Component<HermesLogoProps> = (props) => {
  const markup = () => {
    const cls = `${styles.logo} ${props.class ?? ''}`.trim();
    return svgContent.replace(
      '<svg ',
      `<svg class="${cls}" style="width:100%" `
    );
  };

  return (
    <span
      class={styles.wrapper}
      innerHTML={markup()}
      aria-label="Hermes Agent"
    />
  );
};
