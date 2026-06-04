import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type {
  SubagentStartPayload,
  SubagentProgressPayload,
  SubagentCompletePayload,
  SubagentToolPayload,
  SubagentErrorPayload,
} from '@/types/gateway.js';
import type { SubagentRecord } from '@/types/gateway.js';
import { getGateway } from './context.js';

interface DelegationState {
  subagents: Record<string, SubagentRecord>;
  paused: boolean;
  pausePending: boolean;
  interruptPendingById: Record<string, boolean>;
  error: string | null;
  sortMode: 'spawn-order' | 'slowest' | 'status' | 'busiest';
  filterMode: 'all' | 'running' | 'failed' | 'leaves';
}

const [state, setState] = createStore<DelegationState>({
  subagents: {},
  paused: false,
  pausePending: false,
  interruptPendingById: {},
  error: null,
  sortMode: 'spawn-order',
  filterMode: 'all',
});

export const delegationStore = {
  get subagents() { return state.subagents; },
  get paused() { return state.paused; },
  get pausePending() { return state.pausePending; },
  get interruptPendingById() { return state.interruptPendingById; },
  get error() { return state.error; },
  get sortMode() { return state.sortMode; },
  get filterMode() { return state.filterMode; },

  handleStart(payload: SubagentStartPayload) {
    setState('subagents', payload.subagent_id, {
      subagent_id: payload.subagent_id,
      parent_id: payload.parent_id,
      depth: payload.depth ?? 0,
      model: payload.model,
      goal: payload.goal,
      status: 'running',
      task_count: payload.task_count,
      task_index: payload.task_index,
    });
  },

  handleProgress(payload: SubagentProgressPayload) {
    if (!state.subagents[payload.subagent_id]) return;
    setState('subagents', payload.subagent_id, (r) => ({
      ...r,
      status: payload.status === 'paused' ? 'paused' : r.status,
      tool_count: payload.tool_count ?? r.tool_count,
      toolsets: payload.toolsets ?? r.toolsets,
    }));
  },

  handleComplete(payload: SubagentCompletePayload) {
    if (!state.subagents[payload.subagent_id]) return;
    setState('subagents', payload.subagent_id, (r) => ({
      ...r,
      status: 'complete',
      summary: payload.summary ?? r.summary,
      duration_seconds: payload.duration_seconds ?? r.duration_seconds,
      cost_usd: payload.cost_usd ?? r.cost_usd,
      input_tokens: payload.input_tokens ?? r.input_tokens,
      output_tokens: payload.output_tokens ?? r.output_tokens,
      reasoning_tokens: payload.reasoning_tokens ?? r.reasoning_tokens,
      api_calls: payload.api_calls ?? r.api_calls,
      files_read: payload.files_read ?? r.files_read,
      files_written: payload.files_written ?? r.files_written,
    }));
  },

  handleTool(payload: SubagentToolPayload) {
    if (!state.subagents[payload.subagent_id]) return;
    setState('subagents', payload.subagent_id, 'tool_preview', payload.tool_preview ?? payload.tool_name ?? '');
  },

  handleError(payload: SubagentErrorPayload) {
    if (!state.subagents[payload.subagent_id]) return;
    setState('subagents', payload.subagent_id, (r) => ({
      ...r,
      status: 'error',
      error_text: payload.text ?? r.error_text,
    }));
  },

  async setPaused(paused: boolean): Promise<void> {
    const previous = state.paused;
    setState('paused', paused);
    setState('pausePending', true);
    setState('error', null);
    const gateway = getGateway();
    if (!gateway) {
      setState('pausePending', false);
      return;
    }
    try {
      const result = await gateway.delegation.pause({ paused });
      setState('paused', result.paused);
    } catch (err) {
      setState('paused', previous);
      setState('error', err instanceof Error ? err.message : 'Delegation pause failed');
    } finally {
      setState('pausePending', false);
    }
  },

  async interruptSubagent(subagentId: string): Promise<void> {
    setState('interruptPendingById', subagentId, true);
    setState('error', null);
    const gateway = getGateway();
    if (!gateway) {
      setState('interruptPendingById', subagentId, false);
      return;
    }
    try {
      await gateway.subagent.interrupt({ subagent_id: subagentId });
    } catch (err) {
      setState('error', err instanceof Error ? err.message : 'Subagent interrupt failed');
    } finally {
      setState('interruptPendingById', subagentId, false);
    }
  },

  setSortMode(mode: DelegationState['sortMode']) {
    setState('sortMode', mode);
  },

  setFilterMode(mode: DelegationState['filterMode']) {
    setState('filterMode', mode);
  },

  clear() {
    setState('subagents', {});
    setState('paused', false);
    setState('pausePending', false);
    setState('interruptPendingById', {});
    setState('error', null);
  },
};

export const subagentList = createMemo(() => Object.values(state.subagents));
