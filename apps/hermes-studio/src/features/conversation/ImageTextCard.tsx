import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import styles from './ImageTextCard.module.css';

interface ImageTextCardProps {
  url: string;
  altText?: string | null;
  title: string;
  body: string;
  tags?: string[];
}

export const ImageTextCard: Component<ImageTextCardProps> = (props) => {
  const [loaded, setLoaded] = createSignal(false);
  const [errored, setErrored] = createSignal(false);
  const [lightbox, setLightbox] = createSignal(false);

  const showImage = () => loaded() && !errored();

  return (
    <div class={styles.card}>
      <div class={styles.body}>
        <div class={styles.imgCol} onClick={() => setLightbox(true)}>
          <Show
            when={showImage()}
            fallback={
              <div class={styles.placeholder}>
                <Icon name="image" size={24} />
              </div>
            }
          >
            <img
              class={styles.thumb}
              src={props.url}
              alt={props.altText ?? ''}
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
            />
          </Show>
          <Show when={!loaded() && !errored()}>
            <img
              src={props.url}
              alt=""
              style={{ display: 'none' }}
              onLoad={() => setLoaded(true)}
              onError={() => setErrored(true)}
            />
          </Show>
        </div>
        <div class={styles.textCol}>
          <span class={styles.title}>{props.title}</span>
          <p class={styles.bodyText}>{props.body}</p>
          <Show when={props.tags && props.tags.length > 0}>
            <div class={styles.tags}>
              <For each={props.tags}>
                {(tag) =>
                  tag.toLowerCase().includes('expand') ? (
                    <button class={styles.tagBtn} onClick={() => setLightbox(true)}>{tag}</button>
                  ) : (
                    <span class={styles.tag}>{tag}</span>
                  )
                }
              </For>
            </div>
          </Show>
        </div>
      </div>
      <div class={styles.divider} />
      <Modal
        open={lightbox()}
        title={props.altText ?? props.title}
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
