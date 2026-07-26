import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayAdapter } from '@/services/gateway/types.js';
import { initializeStores } from '../context.js';
import { delegationStore, subagentListForSession } from '../delegation.js';

beforeEach(() => {
  delegationStore.clear();
  initializeStores(null as unknown as GatewayAdapter);
});

describe('delegation store', () => {
  it('keeps subagent rows scoped to their parent session', () => {
    delegationStore.handleStart({
      session_id: 'sess_a',
      subagent_id: 'sa-a',
      goal: 'A',
    });
    delegationStore.handleStart({
      session_id: 'sess_b',
      subagent_id: 'sa-b',
      goal: 'B',
    });

    expect(subagentListForSession('sess_a').map((row) => row.subagent_id)).toEqual(['sa-a']);
    expect(subagentListForSession('sess_b').map((row) => row.subagent_id)).toEqual(['sa-b']);
  });

  it('hydrates active running rows without clearing completed history', () => {
    delegationStore.handleStart({
      session_id: 'sess_a',
      subagent_id: 'sa-a',
      goal: 'A',
    });
    delegationStore.handleComplete({
      session_id: 'sess_a',
      subagent_id: 'sa-a',
      summary: 'done',
    });

    delegationStore.hydrateStatus({
      paused: true,
      active: [{
        session_id: 'sess_a',
        subagent_id: 'sa-a',
        depth: 0,
        goal: 'A',
        status: 'running',
      }],
    });

    const [row] = subagentListForSession('sess_a');
    expect(delegationStore.paused).toBe(true);
    expect(row.status).toBe('complete');
    expect(row.summary).toBe('done');
  });

  it('hydrates new active rows when status includes session_id', () => {
    delegationStore.hydrateStatus({
      paused: false,
      active: [{
        session_id: 'sess_a',
        subagent_id: 'sa-a',
        depth: 1,
        goal: 'Inspect',
        model: 'gpt-test',
        status: 'running',
        tool_count: 2,
      }],
    });

    expect(subagentListForSession('sess_a')).toMatchObject([
      {
        session_id: 'sess_a',
        subagent_id: 'sa-a',
        depth: 1,
        goal: 'Inspect',
        model: 'gpt-test',
        status: 'running',
        tool_count: 2,
      },
    ]);
  });

  it('calls the gateway for global pause changes', async () => {
    const pause = vi.fn().mockResolvedValue({ paused: true });
    initializeStores({
      delegation: {
        status: vi.fn(),
        pause,
      },
    } as unknown as GatewayAdapter);

    await delegationStore.setPaused(true);

    expect(pause).toHaveBeenCalledWith({ paused: true });
    expect(delegationStore.paused).toBe(true);
  });
});
