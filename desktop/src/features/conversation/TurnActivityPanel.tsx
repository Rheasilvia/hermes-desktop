import type { Component } from 'solid-js';
import { createSignal, createEffect, onCleanup, Index, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { ToolCallRow } from '@/types/index.js';
import styles from './TurnActivityPanel.module.css';

export interface TurnActivityPanelProps {
  toolRows?: ToolCallRow[];
  isLive?: boolean;
  embedded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const AnimatedToolCount: Component<{ value: number }> = (props) => {
  const [current, setCurrent] = createSignal(props.value);
  const [previous, setPrevious] = createSignal(props.value);
  const [rolling, setRolling] = createSignal(false);

  createEffect((lastValue: number | undefined) => {
    const nextValue = props.value;
    if (lastValue === undefined) {
      setCurrent(nextValue);
      setPrevious(nextValue);
      return nextValue;
    }
    if (nextValue !== lastValue) {
      setPrevious(lastValue);
      setCurrent(nextValue);
      setRolling(true);
      const timeoutId = window.setTimeout(() => setRolling(false), 220);
      onCleanup(() => window.clearTimeout(timeoutId));
    }
    return nextValue;
  }, undefined);

  return (
    <span
      class={`${styles.toolCount} ${rolling() ? styles.toolCountRolling : ''}`}
      data-testid="tool-completed-count"
      aria-label={`${current()}`}
    >
      <span class={styles.toolCountSizer} aria-hidden="true">{current()}</span>
      <span class={styles.toolCountStack} aria-hidden="true">
        <span class={styles.toolCountDigit}>{previous()}</span>
        <span class={styles.toolCountDigit}>{current()}</span>
      </span>
    </span>
  );
};

const ToolCompletedLabel: Component<{ count: number }> = (props) => {
  const noun = () => (props.count === 1 ? 'tool' : 'tools');
  return (
    <span class={styles.toolCompletedLabel} data-testid="tool-completed-label">
      <AnimatedToolCount value={props.count} />
      <span class={styles.toolCompletedText} data-testid="tool-completed-text">
        {` ${noun()} completed`}
      </span>
    </span>
  );
};

const SummaryLabel: Component<{
  toolCount: number;
}> = (props) => {
  return (
    <ToolCompletedLabel count={props.toolCount} />
  );
};

const SummaryLeadIcon: Component = () => (
  <span class={styles.summaryIconSlot} data-testid="tool-summary-icon-slot">
    <Icon name="check-circle" size={13} class={styles.summaryIcon} />
  </span>
);

// ── TurnActivityPanel ────────────────────────────────────────────────────────
export const TurnActivityPanel: Component<TurnActivityPanelProps> = (props) => {
  const [panelExpanded, setPanelExpanded] = createSignal(false);
  const [settling, setSettling] = createSignal(false);
  // Set of tool row IDs whose result is expanded (second-level)
  const [expandedTools, setExpandedTools] = createSignal(new Set<string>());

  const isLive = () => props.isLive ?? false;

  // Hold the active view for 600ms after isLive drops so checkmark state is readable
  // before collapsing to the summary pill (avoids abrupt disappearance).
  createEffect((prevLive: boolean) => {
    const live = isLive();
    if (prevLive && !live && !panelExpanded()) {
      setSettling(true);
      const t = setTimeout(() => setSettling(false), 600);
      onCleanup(() => clearTimeout(t));
    }
    return live;
  }, isLive());

  const isActive = () => isLive() || settling();
  const hasTools = () => (props.toolRows?.length ?? 0) > 0;

  const completedToolCount = () =>
    (props.toolRows ?? []).filter((row) => row.status === 'complete').length;

  const toggleTool = (id: string) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div class={`${styles.panel} ${props.embedded ? styles.embedded : ''}`}>

      {/* ── ACTIVE STATE (streaming / live tools / settling) ────────────── */}
      <div
        class={styles.activeContent}
        style={{ display: isActive() ? 'flex' : 'none' }}
        aria-hidden={isActive() ? undefined : 'true'}
      >
        <Show when={hasTools()}>
          <div class={`${styles.summaryRow} ${styles.liveToolSummary}`} aria-label="Tool activity summary">
            <SummaryLeadIcon />
            <span class={styles.summaryLabel}>
              <ToolCompletedLabel count={completedToolCount()} />
            </span>
          </div>
        </Show>
      </div>

      {/* ── COLLAPSED PILL ──────────────────────────────────────────────── */}
      <button
        type="button"
        class={`${styles.summaryRow} ${styles.pill}`}
        data-testid="turn-activity-pill"
        style={{ display: !isActive() && !panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && !panelExpanded() ? undefined : 'true'}
        aria-expanded={panelExpanded()}
        aria-label={`${completedToolCount()} ${completedToolCount() === 1 ? 'tool' : 'tools'} completed. Show details`}
        onClick={() => setPanelExpanded(true)}
      >
        <SummaryLeadIcon />
        <span class={styles.summaryLabel}>
          <SummaryLabel toolCount={completedToolCount()} />
        </span>
      </button>

      {/* ── EXPANDED VIEW ───────────────────────────────────────────────── */}
      <div
        class={styles.expanded}
        style={{ display: !isActive() && panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && panelExpanded() ? undefined : 'true'}
      >
        {/* Header doubles as the collapse toggle — click the row to collapse. */}
        <button
          type="button"
          class={`${styles.summaryRow} ${styles.expandedHeader}`}
          aria-label="Collapse tool details"
          onClick={() => setPanelExpanded(false)}
        >
          <SummaryLeadIcon />
          <span class={styles.summaryLabel}>
            <SummaryLabel toolCount={completedToolCount()} />
          </span>
          <Icon name="chevron-down" size={11} class={styles.summaryChevron} aria-hidden="true" />
        </button>

        {/* Tools — name/status/duration visible; result behind ▶ */}
        <Show when={hasTools()}>
          <div class={styles.toolList}>
            <Index each={props.toolRows ?? []}>
              {(row) => {
                const isOpen = () => expandedTools().has(row().id);
                return (
                  <div class={styles.toolRow}>
                    <div class={styles.toolRowContent}>
                      <button
                        class={styles.toolRowMain}
                        classList={{
                          [styles.toolRowMain]: true,
                          [styles.toolRowClickable]: !!row().resultSummary,
                        }}
                        type="button"
                        onClick={() => {
                          if (row().resultSummary) toggleTool(row().id);
                        }}
                        aria-expanded={row().resultSummary ? isOpen() : undefined}
                        aria-label={
                          row().resultSummary
                            ? `${row().name}: ${isOpen() ? 'Hide result' : 'Show result'}`
                            : row().name
                        }
                        disabled={!row().resultSummary}
                      >
                        <span class={styles.toolStatusIconSlot} data-testid="tool-status-icon-slot">
                          <Icon
                            name={
                              row().status === 'complete' ? 'check' :
                              row().status === 'error' ? 'alert-circle' :
                              'clock'
                            }
                            size={12}
                            class={
                              row().status === 'complete' ? styles.doneIcon :
                              row().status === 'error' ? styles.errorIcon :
                              styles.neutralIcon
                            }
                          />
                        </span>
                        <span class={styles.toolName}>{row().name}</span>
                        <Show when={row().argumentPreview}>
                          <span class={styles.argPreview}>{row().argumentPreview}</span>
                        </Show>
                        <Show when={row().durationMs != null}>
                          <span class={styles.duration}>{formatDuration(row().durationMs!)}</span>
                        </Show>
                        {/* ▶/▼ visual indicator for expandable rows */}
                        <Show when={row().resultSummary}>
                          <Icon
                            name={isOpen() ? 'chevron-down' : 'chevron-right'}
                            size={11}
                            class={styles.chevronIndicator}
                          />
                        </Show>
                      </button>
                      <Show when={isOpen() && row().resultSummary}>
                        <pre class={styles.toolResult}>{row().resultSummary}</pre>
                      </Show>
                    </div>
                  </div>
                );
              }}
            </Index>
          </div>
        </Show>
      </div>
    </div>
  );
};
