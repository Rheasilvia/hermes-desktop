import type { Component } from 'solid-js';
import { Show, createEffect, createSignal } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { getNativeHost } from '@/services/native-host.js';
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

const isRemoteImage = (url: string) => /^https?:\/\//i.test(url);
const NATIVE_ASSET_URL = /^hermes-studio-asset:\/\/asset\/[A-Za-z0-9_-]+$/i;
const isNativeAssetImage = (url: string) => NATIVE_ASSET_URL.test(url);
const isRendererSafeImage = (url: string) =>
  /^(https?:|data:|blob:)/i.test(url) || isNativeAssetImage(url);

export const ImageCard: Component<ImageCardProps> = (props) => {
  const [loaded, setLoaded] = createSignal(false);
  const [errored, setErrored] = createSignal(false);
  const [lightbox, setLightbox] = createSignal(false);
  const [copied, setCopied] = createSignal(false);
  const [src, setSrc] = createSignal('');
  let resolution = 0;

  const showImage = () => loaded() && !errored();

  createEffect(() => {
    const url = props.url;
    const request = ++resolution;
    setLoaded(false);
    setErrored(false);
    if (!url) {
      setSrc('');
      return;
    }
    if (isRendererSafeImage(url)) {
      setSrc(url);
      return;
    }
    const host = getNativeHost();
    if (!host) {
      setSrc('');
      return;
    }
    setSrc('');
    void host.assets.urlForPath(url)
      .then((assetUrl) => {
        if (request !== resolution) return;
        if (isNativeAssetImage(assetUrl)) {
          setSrc(assetUrl);
        } else {
          setErrored(true);
        }
      })
      .catch(() => {
        if (request === resolution) setErrored(true);
      });
  });

  const copyImage = () => {
    const host = getNativeHost();
    if (!host || !isRemoteImage(props.url)) return;
    void host.clipboard.copyRemoteImage(props.url)
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
          <Show when={getNativeHost() && isRemoteImage(props.url) && !props.compact}>
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
      <Show when={!loaded() && !errored() && src()}>
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
