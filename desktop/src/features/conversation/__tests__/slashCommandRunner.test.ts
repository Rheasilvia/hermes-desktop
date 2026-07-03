import { describe, expect, it, vi } from 'vitest';
import { createSlashCommandRunner } from '../slashCommandRunner.js';
import type { CommandResult, GatewayAdapter } from '@/services/gateway/types.js';

/**
 * Focused tests for slash command parsing. The regression these guard against:
 * splitting the command from its args on /\s+/ collapses embedded newlines in
 * multiline args (e.g. `/goal <multi-line spec>`) into spaces and drops the
 * line structure before it ever reaches the backend.
 */
function setup(exec: (params: Record<string, unknown>) => Promise<CommandResult>) {
  const slashExec = vi.fn(exec);
  const gateway = {
    slash: { exec: slashExec, resolvePrompt: vi.fn() },
    command: { dispatch: vi.fn() },
  } as unknown as GatewayAdapter;

  const runner = createSlashCommandRunner({
    sessionId: () => 'sess-1',
    getGateway: () => gateway,
    sendPrompt: vi.fn(),
    noticeCard: vi.fn(),
    navigate: vi.fn() as never,
  });
  return { runner, slashExec };
}

describe('createSlashCommandRunner parsing', () => {
  it('preserves embedded newlines in multiline args', async () => {
    const { runner, slashExec } = setup(async () => ({ kind: 'card', cardType: 'notice', text: '' }));
    await runner.handleSlashCommand('/goal line one\nline two\nline three');
    expect(slashExec).toHaveBeenCalledTimes(1);
    const params = slashExec.mock.calls[0][0];
    expect(params.command).toBe('goal');
    expect(params.args).toBe('line one\nline two\nline three');
  });

  it('collapses the separating whitespace run but keeps args intact', async () => {
    const { runner, slashExec } = setup(async () => ({ kind: 'card', cardType: 'notice', text: '' }));
    await runner.handleSlashCommand('/cmd  extra   spaced');
    const params = slashExec.mock.calls[0][0];
    expect(params.command).toBe('cmd');
    // The first run of horizontal whitespace is the separator; internal
    // spacing after that is preserved verbatim.
    expect(params.args).toBe('extra   spaced');
  });

  it('handles a bare command with no args', async () => {
    const { runner, slashExec } = setup(async () => ({ kind: 'card', cardType: 'notice', text: '' }));
    await runner.handleSlashCommand('/help');
    const params = slashExec.mock.calls[0][0];
    expect(params.command).toBe('help');
    expect(params.args).toBe('');
  });
});
