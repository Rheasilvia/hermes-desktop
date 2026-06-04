import type { Component } from 'solid-js';
import { createSignal, createEffect, onCleanup, Index, Show } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import type { ToolCallRow, LiveToolCall } from '@/types/index.js';
import styles from './TurnActivityPanel.module.css';

interface ReasoningData {
  content: string;
  isStreaming: boolean;
  tokenCount: number | null;
}

export interface TurnActivityPanelProps {
  reasoning?: ReasoningData;
  /** Tool rows — accepts both LiveToolCall[] (store-proxy, identity-stable)
   *  and ToolCallRow[] (completed-tool blocks). Fields accessed are the
   *  intersection (id, name, status, durationMs). */
  toolRows?: LiveToolCall[] | ToolCallRow[];
  isLive?: boolean;
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

const LiveToolRow: Component<{ row: () => ToolCallRow }> = (props) => {
  const [entering, setEntering] = createSignal(true);
  const isRowActive = () =>
    props.row().status === 'generating' || props.row().status === 'running';

  const timeoutId = window.setTimeout(() => setEntering(false), 220);
  onCleanup(() => window.clearTimeout(timeoutId));

  return (
    <div class={`${styles.liveRow} ${entering() ? styles.liveRowEntering : ''}`}>
      <span class={styles.connector} aria-hidden="true">└</span>
      <Show
        when={isRowActive()}
        fallback={
          <Icon
            name={props.row().status === 'error' ? 'alert-circle' : 'check'}
            size={12}
            class={props.row().status === 'error' ? styles.errorIcon : styles.doneIcon}
          />
        }
      >
        <span class={`${styles.activeDot} ${styles.pulse}`} />
      </Show>
      <span class={`${styles.toolName} ${isRowActive() ? styles.toolNameActive : ''}`}>
        {props.row().name}
      </span>
      <Show when={props.row().durationMs != null}>
        <span class={styles.duration}>{formatDuration(props.row().durationMs!)}</span>
      </Show>
    </div>
  );
};

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

  const pillLabel = () => {
    const parts: string[] = [];
    if (hasReasoning())
      parts.push(thinkSeconds() ? `Thought for ${thinkSeconds()}` : 'Thought');
    if (hasTools()) {
      const n = props.toolRows!.filter(r => r.status === 'complete').length;
      if (n > 0) parts.push(`${n} tool${n !== 1 ? 's' : ''} completed`);
    }
    return parts.join(' · ');
  };

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
    <div class={styles.panel}>

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
          <div class={styles.liveToolList} aria-label="Live tool activity">
            <Index each={props.toolRows ?? []}>
              {(row) => <LiveToolRow row={row} />}
            </Index>
          </div>
        </Show>
      </div>

      {/* ── COLLAPSED PILL ──────────────────────────────────────────────── */}
      <div
        class={styles.pill}
        style={{ display: !isActive() && !panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && !panelExpanded() ? undefined : 'true'}
      >
        <Icon name="brain" size={12} class={styles.brainIcon} />
        <span class={styles.pillLabel}>{pillLabel()}</span>
        <span class={styles.pillSep} />
        <button class={styles.pillBtn} type="button" onClick={() => setPanelExpanded(true)}>
          <span>Details</span>
          <Icon name="chevron-down" size={11} />
        </button>
      </div>

      {/* ── EXPANDED VIEW ───────────────────────────────────────────────── */}
      <div
        class={styles.expanded}
        style={{ display: !isActive() && panelExpanded() ? 'flex' : 'none' }}
        aria-hidden={!isActive() && panelExpanded() ? undefined : 'true'}
      >
        <div class={styles.expandedHeader}>
          <Icon name="brain" size={12} class={styles.brainIcon} />
          <span class={styles.expandedTitle}>{pillLabel()}</span>
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
                        <div class={styles.toolRowMain}>
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
                          <span class={styles.toolName}>{row().name}</span>
                          <Show when={row().argumentPreview}>
                            <span class={styles.argPreview}>{row().argumentPreview}</span>
                          </Show>
                          <Show when={row().durationMs != null}>
                            <span class={styles.duration}>{formatDuration(row().durationMs!)}</span>
                          </Show>
                          {/* ▶/▼ expands the tool result (second-level expand) */}
                          <Show when={row().resultSummary}>
                            <button
                              class={styles.expandToolBtn}
                              type="button"
                              onClick={() => toggleTool(row().id)}
                              aria-label={isOpen() ? 'Hide result' : 'Show result'}
                            >
                              <Icon
                                name={isOpen() ? 'chevron-down' : 'chevron-right'}
                                size={11}
                              />
                            </button>
                          </Show>
                        </div>
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
