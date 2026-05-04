import { Component, Show } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { ModelSwitcherView } from '@/modules/model/ModelSwitcherView.js';
import { modelStore } from '@/stores/models.js';
import styles from '@/modules/model/ModelSwitcherView.module.css';

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
      const count = modelStore.providers.length;
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

export const ModelPage: Component = () => {
  return (
    <ModuleLayout
      title={pageTitle()}
      description={pageDescription()}
      actions={
        <Show when={modelStore.currentView === 'hub' && modelStore.providers.length > 0}>
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

export default ModelPage;
