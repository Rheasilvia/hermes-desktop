import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import styles from './ImageCard.module.css';

interface ImageCardProps {
  url: string;
  altText?: string | null;
  caption?: string;
  onPreview?: () => void;
}

export const ImageCard: Component<ImageCardProps> = (props) => {
  const [loaded, setLoaded] = createSignal(false);
  const [errored, setErrored] = createSignal(false);
  const [lightbox, setLightbox] = createSignal(false);

  const showImage = () => loaded() && !errored();

  return (
    <div class={styles.container}>
      <div class={styles.frame}>
        <Show
          when={showImage()}
          fallback={
            <div class={styles.placeholder}>
              <Icon name="image" size={20} />
            </div>
          }
        >
          <img
            class={styles.image}
            src={props.url}
            alt={props.altText ?? ''}
            onClick={() => setLightbox(true)}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
        </Show>
      </div>
      {/* Hidden preloader to trigger load/error events */}
      <Show when={!loaded() && !errored()}>
        <img
          src={props.url}
          alt=""
          style={{ display: 'none' }}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      </Show>
      <Show when={props.caption}>
        <div class={styles.caption}>
          <Icon name="image" size={12} />
          <span>{props.caption}</span>
        </div>
      </Show>
      <Modal
        open={lightbox()}
        title={props.altText ?? '图片预览'}
        onClose={() => setLightbox(false)}
        style={{ 'max-width': 'min(90vw, 1000px)', width: 'fit-content' }}
      >
        <img
          class={styles.lightboxImage}
          src={props.url}
          alt={props.altText ?? ''}
        />
      </Modal>
    </div>
  );
};
