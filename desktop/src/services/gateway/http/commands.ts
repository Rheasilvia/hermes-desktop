import type { HttpClient } from '@/services/api/http-client.js';
import type { CardType } from '@/types/command-card.js';
import type {
  CommandAction,
  CommandResult,
  CompletionEntry,
  GatewayAdapter,
} from '../types.js';
import { API_PREFIX } from './shared.js';

/**
 * Normalize backend command-exec JSON into the frontend `CommandResult` union.
 * The backend emits snake_case `card_type`; the UI consumes `cardType`.
 */
export function mapCommandResult(r: Record<string, unknown>): CommandResult {
  const kind = String(r.kind ?? 'error');
  const name = typeof r.name === 'string' ? r.name : undefined;
  const message = typeof r.message === 'string' ? r.message : '';
  if (kind === 'card') {
    return { kind: 'card', cardType: r.card_type as CardType, text: message || undefined, name };
  }
  if (kind === 'action') {
    return { kind: 'action', action: r.action as CommandAction, message, name };
  }
  return { kind: kind as 'output' | 'send' | 'skill' | 'unsupported' | 'error', message, name };
}

export function makeCompleteGateway(http: HttpClient): GatewayAdapter['complete'] {
  return {
    slash: async (params) => {
      const r = await http.post<{ items: Array<{ command: string; description: string; category?: string; icon?: string }> }>(
        `${API_PREFIX}/commands/complete/slash`,
        { partial: params.partial },
      );
      return r.items ?? [];
    },
    path: async (params): Promise<CompletionEntry[]> => {
      const body: Record<string, unknown> = {
        word: params.partial,
        session_id: params.sessionId,
      };
      const r = await http.post<{ items?: CompletionEntry[] }>(
        `${API_PREFIX}/commands/complete/path`,
        body,
      );
      return Array.isArray(r.items) ? r.items : [];
    },
  };
}

export function makeSlashGateway(http: HttpClient): GatewayAdapter['slash'] {
  return {
    exec: async (params): Promise<CommandResult> =>
      mapCommandResult(
        await http.post<Record<string, unknown>>(`${API_PREFIX}/commands/slash/exec`, params),
      ),
  };
}

export function makeCommandGateway(http: HttpClient): GatewayAdapter['command'] {
  return {
    dispatch: async (params): Promise<CommandResult> =>
      mapCommandResult(
        await http.post<Record<string, unknown>>(`${API_PREFIX}/commands/dispatch`, params),
      ),
  };
}
