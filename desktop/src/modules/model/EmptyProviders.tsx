import type { Component } from 'solid-js';
import { For } from 'solid-js';
import { modelStore, BUILT_IN_PROVIDERS } from '@/stores/models.js';
import { Button } from '@/components/Button.js';
import styles from './EmptyProviders.module.css';

export const EmptyProviders: Component = () => {
  const popularProviders = () =>
    BUILT_IN_PROVIDERS.filter(p => p.category === 'popular').slice(0, 3);

  return (
    <div class={styles.wrapper}>
      <div class={styles.content}>
        <div class={styles.icon}>+</div>
        <h2 class={styles.title}>No providers configured</h2>
        <p class={styles.description}>
          Add a provider to start using AI models in your conversations
        </p>
        <Button variant="primary" size="md" onClick={() => modelStore.navigateTo('add-provider')}>
          Add Your First Provider
        </Button>
      </div>
      <div class={styles.recommended}>
        <p class={styles.recommendedLabel}>Recommended</p>
        <div class={styles.recommendedCards}>
          <For each={popularProviders()}>
            {(provider) => (
              <div class={styles.recommendedCard}>
                <span class={styles.providerName}>{provider.name}</span>
                <span class={styles.providerDesc}>{provider.description}</span>
                <span class={styles.badge}>Popular</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
};
