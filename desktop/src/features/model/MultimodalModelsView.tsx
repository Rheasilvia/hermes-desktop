/**
 * Multimodal model configuration — auxiliary task matrix.
 * Port of apps/desktop/src/app/settings/model-settings.tsx to SolidJS.
 */
import type { Component } from 'solid-js';
import { For, Show, createSignal, onMount } from 'solid-js';
import { Button } from '@/ui/atoms/Button.js';
import { Select } from '@/ui/atoms/Select.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { auxiliaryModelStore, modelsStore } from '@/stores/models.js';
import type { AuxTaskEntry } from '@/services/api/transports/http/model.js';
import styles from './MultimodalModelsView.module.css';

const AUX_TASK_LABELS: Record<string, { label: string; hint: string }> = {
  vision: { label: 'Vision', hint: 'Image understanding' },
  web_extract: { label: 'Web Extract', hint: 'Page content extraction' },
  compression: { label: 'Compression', hint: 'Context summarization' },
  skills_hub: { label: 'Skills Hub', hint: 'Skill routing & dispatch' },
  approval: { label: 'Approval', hint: 'Safety & command review' },
  mcp: { label: 'MCP', hint: 'Tool call routing' },
  title_generation: { label: 'Title Generation', hint: 'Session naming' },
  triage_specifier: { label: 'Triage', hint: 'Issue triage' },
  kanban_decomposer: { label: 'Kanban', hint: 'Task decomposition' },
  profile_describer: { label: 'Profile', hint: 'User profile analysis' },
  curator: { label: 'Curator', hint: 'Memory & context curation' },
};

export const MultimodalModelsView: Component = () => {
  const [applying, setApplying] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<string | null>(null);
  const [draftProvider, setDraftProvider] = createSignal('');
  const [draftModel, setDraftModel] = createSignal('');
  const [error, setError] = createSignal('');

  onMount(() => void auxiliaryModelStore.load());

  const data = () => auxiliaryModelStore.data;
  const staleAux = () => auxiliaryModelStore.staleAux;
  const mainProvider = () => data()?.main.provider ?? '';

  const providerOptions = () =>
    modelsStore.providers().map((p) => ({ value: p.name, label: p.display_name ?? p.name }));

  const modelsForProvider = (provider: string) => {
    const p = modelsStore.providers().find((pr) => pr.name === provider);
    return (p?.models ?? []).map((m) => ({ value: m.name, label: m.display_name ?? m.name }));
  };

  const isAuto = (entry: AuxTaskEntry) =>
    !entry.provider || entry.provider === 'auto';

  const doAssign = async (scope: 'main' | 'auxiliary', provider: string, model: string, task?: string) => {
    setApplying(true);
    setError('');
    try {
      await auxiliaryModelStore.assign({ scope, provider, model, task });
      setEditingTask(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setApplying(false);
    }
  };

  const resetAll = () => void doAssign('auxiliary', 'auto', '', '__reset__');

  const setToMain = (task: string) => {
    const main = data()?.main;
    if (!main) return;
    void doAssign('auxiliary', main.provider, main.model, task);
  };

  const beginEdit = (entry: AuxTaskEntry) => {
    setDraftProvider(isAuto(entry) ? (mainProvider() || '') : entry.provider);
    setDraftModel(isAuto(entry) ? (data()?.main.model ?? '') : entry.model);
    setEditingTask(entry.task);
  };

  const applyDraft = (task: string) => {
    if (!draftProvider() || !draftModel()) return;
    void doAssign('auxiliary', draftProvider(), draftModel(), task);
  };

  return (
    <div class={styles.container}>
      {/* Main model display */}
      <section>
        <div class={styles.headerRow}>
          <h4 class={styles.sectionTitle}>Main Model</h4>
        </div>
        <p class={styles.sectionDesc}>
          The default model used for all auxiliary tasks unless overridden below.
        </p>
        <div class={styles.mainRow}>
          <Show when={data()?.main} fallback={<span class={styles.sectionDesc}>Loading…</span>}>
            {(main) => (
              <span class={styles.mainBadge}>
                <Icon name="cpu" size={12} />
                {main().provider} · {main().model || 'default'}
              </span>
            )}
          </Show>
        </div>
      </section>

      {/* Stale aux warning */}
      <Show when={staleAux().length > 0}>
        <div class={styles.staleWarning}>
          <Icon name="alert-triangle" size={14} />
          <span class={styles.staleText}>
            {staleAux().length} auxiliary task{staleAux().length === 1 ? '' : 's'} still routed to a different provider than your main model.
          </span>
          <Button variant="secondary" size="sm" disabled={applying()} onClick={resetAll}>
            Reset all to main
          </Button>
        </div>
      </Show>

      {/* Auxiliary task matrix */}
      <section>
        <div class={styles.headerRow}>
          <h4 class={styles.sectionTitle}>Auxiliary Task Models</h4>
          <Button variant="ghost" size="sm" disabled={applying()} onClick={resetAll}>
            Reset all to main
          </Button>
        </div>
        <p class={styles.sectionDesc}>
          Override which model handles each background task. "Auto" follows the main model.
        </p>

        <Show when={auxiliaryModelStore.error}>
          <div class={styles.error}>{auxiliaryModelStore.error}</div>
        </Show>

        <Show when={data()} fallback={<div class={styles.sectionDesc}>Loading…</div>}>
          {(d) => (
            <div class={styles.taskGrid}>
              <For each={d().tasks}>
                {(entry) => {
                  const meta = () => AUX_TASK_LABELS[entry.task] ?? { label: entry.task, hint: '' };
                  const isEditing = () => editingTask() === entry.task;

                  return (
                    <>
                      <div class={styles.taskRow}>
                        <span class={styles.taskLabel} title={meta().hint}>
                          {meta().label}
                          <Show when={meta().hint}>
                            {' '}
                            <span style={{ 'font-weight': '400', opacity: '0.6', 'font-size': '0.7rem' }}>
                              — {meta().hint}
                            </span>
                          </Show>
                        </span>
                        <span class={styles.taskCurrent}>
                          {isAuto(entry)
                            ? 'auto (main)'
                            : `${entry.provider} · ${entry.model || 'default'}`}
                        </span>
                        <Show when={!isEditing()}>
                          <div class={styles.taskActions}>
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={applying()}
                              onClick={() => setToMain(entry.task)}
                            >
                              Set to main
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={applying()}
                              onClick={() => beginEdit(entry)}
                            >
                              Change
                            </Button>
                          </div>
                        </Show>
                      </div>

                      <Show when={isEditing()}>
                        <div class={styles.editRow}>
                          <Select
                            value={draftProvider()}
                            options={providerOptions()}
                            onChange={setDraftProvider}
                            placeholder="Provider"
                          />
                          <Select
                            value={draftModel()}
                            options={modelsForProvider(draftProvider())}
                            onChange={setDraftModel}
                            placeholder="Model"
                          />
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={!draftProvider() || !draftModel() || applying()}
                            onClick={() => applyDraft(entry.task)}
                          >
                            {applying() ? 'Applying…' : 'Apply'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditingTask(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </Show>
                    </>
                  );
                }}
              </For>
            </div>
          )}
        </Show>

        <Show when={error()}>
          <div class={styles.error}>{error()}</div>
        </Show>
      </section>
    </div>
  );
};
