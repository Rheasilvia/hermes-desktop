import type { Component } from 'solid-js';
import { createEffect, For, Show } from 'solid-js';
import { analyticsStore } from '@/stores/analytics.js';
import { modelStore } from '@/stores/models.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { EmptyState } from '@/components/EmptyState.js';
import { UsageSummaryBar } from './UsageSummaryBar.js';
import { ModelUsageCard } from './ModelUsageCard.js';
import type { AnalyticsPeriod } from '@/types/analytics.js';
import styles from './ModelUsageView.module.css';

export const ModelUsageView: Component = () => {
  createEffect(() => {
    void analyticsStore.load();
  });

  const handlePeriodChange = (p: AnalyticsPeriod) => {
    analyticsStore.setPeriod(p);
    void analyticsStore.load(p);
  };

  return (
    <div class={styles.container}>
      <Show when={analyticsStore.isLoading()}>
        <div class={styles.loading}>
          <LoadingSpinner size="lg" />
        </div>
      </Show>

      <Show when={!analyticsStore.isLoading() && analyticsStore.data()}>
        {(data) => (
          <>
            <UsageSummaryBar
              totals={data().totals}
              period={analyticsStore.period()}
              onPeriodChange={handlePeriodChange}
            />

            <Show
              when={data().models.length > 0}
              fallback={
                <EmptyState
                  icon="📊"
                  title="No usage data"
                  description={`No model usage recorded in the last ${analyticsStore.period()} days.`}
                />
              }
            >
              <div class={styles.grid}>
                <For each={data().models}>
                  {(stat) => (
                    <ModelUsageCard
                      stat={stat}
                      isActive={
                        modelStore.activeProvider === stat.provider &&
                        modelStore.activeModel === stat.model
                      }
                    />
                  )}
                </For>
              </div>
            </Show>
          </>
        )}
      </Show>

      <Show when={analyticsStore.error()}>
        <div class={styles.error}>{analyticsStore.error()}</div>
      </Show>
    </div>
  );
};
