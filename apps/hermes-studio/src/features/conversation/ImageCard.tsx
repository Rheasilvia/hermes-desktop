import type { Component } from 'solid-js';
import { Show, createSignal } from 'solid-js';
import { invoke, isTauri, convertFileSrc } from '@tauri-apps/api/core';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import styles from './ImageCard.module.css';

interface ImageCardProps {
  url: string;
  altText?: string | null;
  caption?: string;
  onPreview?: () => void;
  /** Compact mode: fixed small thumbnail, no lightbox, no caption, no copy
   *  button. Used for user-message attachment previews. */
  compact?: boolean;
}

/**
 * Resolves an image URL for use in <img src>. Raw filesystem paths (e.g. a
 * clipboard temp file or a workspace image) do not load in the Tauri webview
 * unless wrapped via `convertFileSrc` (asset protocol). Remote http(s) URLs
 * and in-memory schemes (data:, blob:, asset:) pass through unchanged.
 */
function resolveImgSrc(url: string): string {
  if (!url) return url;
  if (/^(https?:|data:|blob:|asset:)/i.test(url)) return url;
  return isTauri() ? convertFileSrc(url) : url;
}

export const ImageCard: Component<ImageCardProps> = (props) => {
  const [loaded, setLoaded] = createSignal(false);
  const [errored, setErrored] = createSignal(false);
  const [lightbox, setLightbox] = createSignal(false);
  const [copied, setCopied] = createSignal(false);

  const showImage = () => loaded() && !errored();
  const src = () => resolveImgSrc(props.url);

  const copyImage = () => {
    if (!isTauri()) return;
    void invoke('write_clipboard_image_from_url', { url: props.url })
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {
        /* best-effort */
      });
  };

  return (
    <div class={styles.container} classList={{ [styles.compact]: Boolean(props.compact) }}>
      <div class={styles.frame}>
        <Show
          when={showImage()}
          fallback={
            <div class={styles.placeholder}>
              <Icon name="image" size={props.compact ? 14 : 20} />
            </div>
          }
        >
          <img
            class={styles.image}
            src={src()}
            alt={props.altText ?? ''}
            onClick={() => setLightbox(true)}
            onLoad={() => setLoaded(true)}
            onError={() => setErrored(true)}
          />
          <Show when={isTauri() && !props.compact}>
            <button
              type="button"
              class={styles.copyBtn}
              title={copied() ? 'Copied' : 'Copy image'}
              aria-label="Copy image to clipboard"
              onClick={(e) => { e.stopPropagation(); copyImage(); }}
            >
              <Icon name={copied() ? 'check' : 'copy'} size={14} />
            </button>
          </Show>
        </Show>
      </div>
      {/* Hidden preloader to trigger load/error events */}
      <Show when={!loaded() && !errored()}>
        <img
          src={src()}
          alt=""
          style={{ display: 'none' }}
          onLoad={() => setLoaded(true)}
          onError={() => setErrored(true)}
        />
      </Show>
      <Show when={props.caption && !props.compact}>
        <div class={styles.caption}>
          <Icon name="image" size={12} />
          <span>{props.caption}</span>
        </div>
      </Show>
      <Show when={lightbox()}>
        <Modal
          open={lightbox()}
          title={props.altText ?? '图片预览'}
          onClose={() => setLightbox(false)}
          style={{ 'max-width': 'min(90vw, 1000px)', width: 'fit-content' }}
        >
          <img
            class={styles.lightboxImage}
            src={src()}
            alt={props.altText ?? ''}
          />
        </Modal>
      </Show>
    </div>
  );
};
