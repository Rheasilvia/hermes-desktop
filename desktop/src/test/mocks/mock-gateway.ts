/**
 * Test mock for the gateway adapter.
 * Provides a simple stub implementation without importing the real MockGatewayAdapter.
 */

import type { GatewayAdapter, ConnectionState, GatewayEventMap } from '@/services/gateway/types.js';

type EventHandler<K extends keyof GatewayEventMap> = (payload: GatewayEventMap[K]) => void;

/**
 * Creates a minimal mock gateway adapter for unit tests.
 * Unlike the full MockGatewayAdapter in services/gateway, this is a simple stub
 * that returns empty/default values and does not simulate timing.
 */
export function createTestGateway(): GatewayAdapter {
  const handlers = new Map<string, Set<EventHandler<keyof GatewayEventMap>>>();

  const addHandler = <K extends keyof GatewayEventMap>(event: K, handler: EventHandler<K>): void => {
    if (!handlers.has(event)) {
      handlers.set(event, new Set());
    }
    handlers.get(event)!.add(handler as EventHandler<keyof GatewayEventMap>);
  };

  const removeHandler = <K extends keyof GatewayEventMap>(event: K, handler: EventHandler<K>): void => {
    handlers.get(event)?.delete(handler as EventHandler<keyof GatewayEventMap>);
  };

  const emit = <K extends keyof GatewayEventMap>(event: K, payload: GatewayEventMap[K]): void => {
    handlers.get(event)?.forEach(h => {
      try { h(payload); } catch { /* swallow */ }
    });
  };

  return {
    session: {
      list: async () => [],
      info: async () => ({ model: '', skills: {}, tools: {}, usage: { calls: 0, input: 0, output: 0, total: 0, cost_usd: 0 } }),
      create: async () => ({ id: 'test-session', source: 'mock', model: '', title: 'Test Session', started_at: '', ended_at: null, message_count: 0, tool_call_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, billing_provider: 'mock', billing_base_url: null, billing_mode: 'auto', estimated_cost_usd: 0, actual_cost_usd: null, cost_status: null, cost_source: null, pricing_version: null, user_id: null, model_config: null, system_prompt: null, parent_session_id: null, end_reason: null }),
      delete: async () => {},
      branch: async () => ({ id: 'test-branch', source: 'mock', model: '', title: 'Branch', started_at: '', ended_at: null, message_count: 0, tool_call_count: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, reasoning_tokens: 0, billing_provider: 'mock', billing_base_url: null, billing_mode: 'auto', estimated_cost_usd: 0, actual_cost_usd: null, cost_status: null, cost_source: null, pricing_version: null, user_id: null, model_config: null, system_prompt: null, parent_session_id: null, end_reason: null }),
      resume: async () => {},
      interrupt: async () => {},
      messages: async () => [],
    },
    prompt: {
      execute: async () => {},
    },
    config: {
      get: async () => ({ model: { provider: 'test', model: 'test-model' }, providers: {}, fallback_providers: [], toolsets: { enabled: [], disabled: [] }, agent: { max_iterations: 90, save_trajectories: false, system_prompt: undefined }, display: { theme: 'dark', skin: 'default', show_cost: true, show_reasoning: true, tool_progress_command: 'default', background_process_notifications: 'all' }, memory: { enabled: true, max_entries: 1000 }, cron: { enabled: true, max_jobs: 20 }, security: { approval_required: true, dangerous_commands: [] }, _config_version: 5 }),
      getMtime: async () => 0,
      set: async () => {},
    },
    tools: {
      list: async () => [],
      reload: async () => {},
    },
    model: {
      options: async () => ({ providers: [], model: 'test-model', provider: 'test' }),
    },
    provider: {
      upsert: async () => ({ name: 'test' }),
      delete: async () => ({ ok: true }),
    },
    approval: {
      respond: async () => {},
    },
    clarify: {
      respond: async () => {},
    },
    sudo: {
      respond: async () => {},
    },
    secret: {
      respond: async () => {},
    },
    cron: {
      list: async () => [],
      create: async () => ({ id: 'cron-test', name: 'Test', prompt: '', skills: [], skill: null, model: null, provider: null, base_url: null, api_key: null, script: null, schedule: { kind: 'once', display: '' }, schedule_display: '', repeat: { times: null, completed: 0 }, enabled: true, state: 'scheduled', paused_at: null, paused_reason: null, created_at: '', next_run_at: null, last_run_at: null, last_status: null, last_error: null, last_delivery_error: null, deliver: 'origin', origin: null }),
      update: async () => ({ id: 'cron-test', name: 'Test', prompt: '', skills: [], skill: null, model: null, provider: null, base_url: null, api_key: null, script: null, schedule: { kind: 'once', display: '' }, schedule_display: '', repeat: { times: null, completed: 0 }, enabled: true, state: 'scheduled', paused_at: null, paused_reason: null, created_at: '', next_run_at: null, last_run_at: null, last_status: null, last_error: null, last_delivery_error: null, deliver: 'origin', origin: null }),
      delete: async () => {},
    },
    mcp: {
      list: async () => [],
      add: async () => ({ name: 'test', command: '', args: [], transport: 'stdio' }),
      remove: async () => {},
      tools: async () => [],
    },
    memory: {
      files: async () => [],
      contextFiles: async () => [],
      search: async () => [],
    },
    skills: {
      list: async () => [] as import('@/services/gateway/types.js').SkillInfo[],
    },
    complete: {
      slash: async () => [],
      path: async () => [],
    },
    slash: {
      exec: async () => {},
    },
    command: {
      dispatch: async () => {},
    },
    on: addHandler,
    off: removeHandler,
    connect: async () => {
      emit('gateway.ready', { skin: undefined });
      emit('session.info', { model: 'test', skills: {}, tools: {}, usage: { calls: 0, input: 0, output: 0, total: 0, cost_usd: 0 } });
    },
    disconnect: async () => {
      handlers.clear();
    },
    getConnectionState: (): ConnectionState => 'connected',
  };
}
