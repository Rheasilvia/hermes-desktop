import type { Component } from 'solid-js';
import { createSignal, createEffect, onCleanup, Index, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { ToolCallRow } from '@/types/index.js';
import styles from './TurnActivityPanel.module.css';

interface ReasoningData {
  content: string;
  isStreaming: boolean;
  tokenCount: number | null;
}

export interface TurnActivityPanelProps {
  reasoning?: ReasoningData;
  toolRows?: ToolCallRow[];
  isLive?: boolean;
  embedded?: boolean;
}

// ── ThinkingIndicator ────────────────────────────────────────────────────────
// JS-driven animation so RAF never restarts on streaming deltas.
// Always mounted; shown/hidden via display:none on the parent div.
const BAR_WIDTH = 120;
const DURATION_MS = 2000;

const ThinkingIndicator: Component = () => {
  let trackRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!trackRef) return;
    const track = trackRef;
    let rafId: number;
    const startTime = performance.now();

    function animate(now: number) {
      const elapsed = now - startTime;
      const progress = (elapsed % DURATION_MS) / DURATION_MS;
      const parentWidth = track.parentElement?.getBoundingClientRect().width ?? 0;
      const x = -BAR_WIDTH + progress * (parentWidth + BAR_WIDTH * 2);
      track.style.transform = `translateX(${x}px)`;
      rafId = requestAnimationFrame(animate);
    }

    rafId = requestAnimationFrame(animate);
    onCleanup(() => cancelAnimationFrame(rafId));
  });

  return (
    <>
      <div class={styles.thinkingHeader}>
        <Icon name="brain" size={13} class={styles.brainIcon} />
        <span class={styles.thinkingLabel}>Thinking...</span>
        <div class={styles.dotRow}>
          <span class={styles.dot} />
          <span class={styles.dot} />
          <span class={styles.dot} />
        </div>
      </div>
      <div class={styles.progressBar}>
        <div ref={(el) => { trackRef = el; }} class={styles.progressBarTrack} />
      </div>
    </>
  );
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatThinkSeconds(tokenCount: number | null): string {
  if (!tokenCount || tokenCount <= 0) return '';
  return `${Math.max(1, Math.round(tokenCount / 50))}s`;
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
  hasReasoning: boolean;
  thinkSeconds: string;
  toolCount: number | null;
}> = (props) => {
  const hasTools = () => props.toolCount != null;
  return (
    <>
      <Show when={props.hasReasoning}>
        <span>{props.thinkSeconds ? `Thought for ${props.thinkSeconds}` : 'Thought'}</span>
      </Show>
      <Show when={props.hasReasoning && hasTools()}>
        <span class={styles.summaryDot} aria-hidden="true">·</span>
      </Show>
      <Show when={hasTools()}>
        <ToolCompletedLabel count={props.toolCount!} />
      </Show>
    </>
  );
};

const SummaryLeadIcon: Component<{ hasTools: boolean }> = (props) => (
  <span class={styles.summaryIconSlot} data-testid="tool-summary-icon-slot">
    <Show
      when={props.hasTools}
      fallback={<Icon name="brain" size={13} class={styles.brainIcon} />}
    >
      <Icon name="check-circle" size={13} class={styles.summaryIcon} />
    </Show>
  </span>
);

const DetailsAffordance: Component<{
  hidden?: boolean;
  onClick?: () => void;
}> = (props) => (
  <span
    class={`${styles.summaryActions} ${props.hidden ? styles.summaryActionsPlaceholder : ''}`}
    data-testid="tool-summary-actions"
    aria-hidden={props.hidden ? 'true' : undefined}
  >
    <span class={styles.pillSep} />
    <Show
      when={!props.hidden}
      fallback={
        <span class={styles.pillBtn}>
          <span>Details</span>
          <Icon name="chevron-down" size={11} />
        </span>
      }
    >
      <button class={styles.pillBtn} type="button" onClick={props.onClick}>
        <span>Details</span>
        <Icon name="chevron-down" size={11} />
      </button>
    </Show>
  </span>
);

// ── TurnActivityPanel ────────────────────────────────────────────────────────
export const TurnActivityPanel: Component<TurnActivityPanelProps> = (props) => {
  const [panelExpanded, setPanelExpanded] = createSignal(false);
  const [settling, setSettling] = createSignal(false);
  // Set of tool row IDs whose result is expanded (second-level)
  const [expandedTools, setExpandedTools] = createSignal(new Set<string>());

  const isThinking = () => props.reasoning?.isStreaming ?? false;
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

  const isActive = () => isThinking() || isLive() || settling();
  const hasReasoning = () => !!props.reasoning;
  const hasTools = () => (props.toolRows?.length ?? 0) > 0;

  const thinkSeconds = () => formatThinkSeconds(props.reasoning?.tokenCount ?? null);
  const completedToolCount = () =>
    (props.toolRows ?? []).filter((row) => row.status === 'complete').length;

  const toolCountForSummary = () => hasTools() ? completedToolCount() : null;

  // DOM ref for reasoning text — updated imperatively so ThinkingIndicator
  // RAF loop never restarts on streaming content changes.
  let reasoningTextRef: HTMLPreElement | undefined;
  createEffect(() => {
    if (reasoningTextRef)
      reasoningTextRef.textContent = props.reasoning?.content ?? '';
  });

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
      {/* ThinkingIndicator parent always mounted; display:none when not thinking */}
      <div
        class={styles.activeContent}
        style={{ display: isActive() ? 'flex' : 'none' }}
        aria-hidden={isActive() ? undefined : 'true'}
      >
        <div style={{ display: isThinking() ? 'contents' : 'none' }}>
          <ThinkingIndicator />
        </div>

        <Show when={hasTools()}>
          <div class={`${styles.summaryRow} ${styles.liveToolSummary}`} aria-label="Tool activity summary">
            <SummaryLeadIcon hasTools={hasTools()} />
            <span class={styles.summaryLabel}>
              <ToolCompletedLabel count={completedToolCount()} />
            </span>
            <DetailsAffordance hidden />
          </div>
        </Show>
      </div>

      {/* ── COLLAPSED PILL ──────────────────────────────────────────────── */}
      <div
        class={`${styles.summaryRow} ${styles.pill}`}
        data-testid="turn-activity-pill"
        style={{ display: !isActive() && !panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && !panelExpanded() ? undefined : 'true'}
      >
        <SummaryLeadIcon hasTools={hasTools()} />
        <span class={styles.summaryLabel}>
          <SummaryLabel
            hasReasoning={hasReasoning()}
            thinkSeconds={thinkSeconds()}
            toolCount={toolCountForSummary()}
          />
        </span>
        <DetailsAffordance onClick={() => setPanelExpanded(true)} />
      </div>

      {/* ── EXPANDED VIEW ───────────────────────────────────────────────── */}
      <div
        class={styles.expanded}
        style={{ display: !isActive() && panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && panelExpanded() ? undefined : 'true'}
      >
        <div class={`${styles.summaryRow} ${styles.expandedHeader}`}>
          <SummaryLeadIcon hasTools={hasTools()} />
          <span class={styles.summaryLabel}>
            <SummaryLabel
              hasReasoning={hasReasoning()}
              thinkSeconds={thinkSeconds()}
              toolCount={toolCountForSummary()}
            />
          </span>
          <button
            class={styles.collapseBtn}
            type="button"
            aria-label="Collapse details"
            onClick={() => setPanelExpanded(false)}
          >
            <Icon name="chevron-left" size={11} />
          </button>
        </div>

        {/* Reasoning section */}
        <Show when={hasReasoning()}>
          <div class={styles.section}>
            <div class={styles.sectionLabel}>
              Reasoning{thinkSeconds() ? ` · ${thinkSeconds()}` : ''}
            </div>
            <pre ref={(el) => { reasoningTextRef = el; }} class={styles.reasoningText} />
          </div>
        </Show>

        {/* Tools section — name/status/duration visible; result behind ▶ */}
        <Show when={hasTools()}>
          <div class={styles.section}>
            <div class={styles.sectionLabel}>Tools</div>
            <div class={styles.toolList}>
              <Index each={props.toolRows ?? []}>
                {(row) => {
                  const isOpen = () => expandedTools().has(row().id);
                  return (
                    <div class={styles.toolRow}>
                      <span class={styles.connector} aria-hidden="true">└</span>
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
          </div>
        </Show>
      </div>
    </div>
  );
};
