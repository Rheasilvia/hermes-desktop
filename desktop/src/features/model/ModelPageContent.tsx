import { Component, Show } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { ModelSwitcherView } from '@/features/model/ModelSwitcherView.js';
import { modelStore, modelsStore } from '@/stores/models.js';
import styles from '@/features/model/ModelSwitcherView.module.css';

const pageTitle = (): string => {
  switch (modelStore.currentView) {
    case 'add-provider':
      return 'Add Provider';
    case 'provider-detail':
      return modelStore.detailProviderEntry?.display_name ??
        modelStore.detailProviderName ??
        'Provider';
    case 'model-detail':
      return 'Model Configuration';
    default:
      return 'Model';
  }
};

const pageDescription = (): string | undefined => {
  switch (modelStore.currentView) {
    case 'hub': {
      if (!modelsStore.hasLoaded() && modelsStore.providers().length === 0) {
        return 'Loading configured providers';
      }
      const count = modelsStore.providers().length;
      if (modelsStore.loading() && count > 0) {
        return `${count} configured provider${count === 1 ? '' : 's'} · refreshing`;
      }
      return `${count} configured provider${count === 1 ? '' : 's'}`;
    }
    case 'add-provider':
      return 'Add a new model provider';
    case 'provider-detail':
      return `${modelStore.detailProviderEntry?.models?.length ?? 0} models available`;
    case 'model-detail': {
      const model = modelStore.detailModelOption;
      return model
        ? `${model.display_name ?? model.name} · ${modelStore.detailProviderEntry?.display_name ?? modelStore.detailProviderName ?? ''}`
        : undefined;
    }
    default:
      return undefined;
  }
};

export const ModelPageContent: Component = () => {
  return (
    <ModuleLayout
      title={pageTitle()}
      description={pageDescription()}
      actions={
        <Show when={modelStore.currentView === 'hub' && modelsStore.providers().length > 0}>
          <button
            type="button"
            class={styles.addBtn}
            onClick={() => modelStore.navigateTo('add-provider')}
          >
            + Add Provider
          </button>
        </Show>
      }
    >
      <ModelSwitcherView />
    </ModuleLayout>
  );
};
