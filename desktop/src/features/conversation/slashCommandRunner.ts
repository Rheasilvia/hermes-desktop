import type { Navigator } from '@solidjs/router';
import type { CommandResult } from '@/services/gateway/types.js';
import type { GatewayAdapter } from '@/services/gateway/types.js';
import { runCommandAction } from './commandActions.js';
import { sessionStore } from '@/stores/session.js';

export function createSlashCommandRunner(opts: {
  sessionId: () => string;
  getGateway: () => GatewayAdapter | null;
  sendPrompt: (text: string, display?: { text: string; slashCommand?: { command: string; args: string } }) => Promise<void>;
  noticeCard: (text: string) => void;
  navigate: Navigator;
}) {
  const showCommandResult = async (result: CommandResult, ctx: { command: string; args: string }) => {
    switch (result.kind) {
      case 'card':
        opts.noticeCard(result.text ?? '');
        return;
      case 'skill': {
        const compact = ctx.args ? `/${ctx.command} ${ctx.args}` : `/${ctx.command}`;
        void opts.sendPrompt(result.message, { text: compact, slashCommand: { command: ctx.command, args: ctx.args } });
        return;
      }
      case 'send':
        void opts.sendPrompt(result.message);
        return;
      case 'action':
        await runCommandAction(result, {
          sessionId: opts.sessionId(),
          navigate: opts.navigate,
          sessionStore,
          notify: opts.noticeCard,
        });
        return;
      case 'unsupported':
        opts.noticeCard(result.message);
        return;
      case 'error':
        opts.noticeCard(`Command error: ${result.message}`);
        return;
      default:
        opts.noticeCard(result.message || 'Command produced no output.');
    }
  };

  const handleSlashCommand = async (text: string) => {
    const gateway = opts.getGateway();
    if (!gateway) {
      opts.noticeCard('Command error: gateway is not connected.');
      return;
    }
    const raw = text.trim();
    const withoutSlash = raw.slice(1).trim();
    const [command, ...rest] = withoutSlash.split(/\s+/);
    const args = rest.join(' ');
    const params = { session_id: opts.sessionId(), command, args, raw };
    let result: CommandResult;
    try {
      result = await gateway.slash.exec(params);
    } catch {
      try {
        result = await gateway.command.dispatch(params);
      } catch (err) {
        opts.noticeCard(`Command error: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    try {
      await showCommandResult(result, { command, args });
    } catch (err) {
      opts.noticeCard(`Command error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return { handleSlashCommand, showCommandResult };
}
