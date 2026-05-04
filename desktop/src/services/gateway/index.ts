export { type ConnectionState, type GatewayEventMap, type GatewayEventEmitter, type GatewayAdapter, type GatewayAdapterOptions, type SessionMethods, type PromptMethods, type ConfigMethods, type ToolsMethods, type ModelMethods, type ProviderMethods, type ApprovalMethods, type ClarifyMethods, type SudoMethods, type SecretMethods, type CronMethods, type McpMethods, type MemoryMethods, type SkillsMethods, type CompleteMethods, type SlashMethods, type CommandMethods, type ModelOptionsResult, type UpsertProviderInput, type DeleteProviderInput, type ConfigSetInput, } from './types.js';

export {
  type Transport,
  StdioTransportPlaceholder,
  type StdioTransportOptions,
  BaseJsonRpcTransport,
  DEFAULT_REQUEST_TIMEOUT_MS,
} from './transport.js';

export { GatewayClient } from './client.js';

export { MockGatewayAdapter } from './mock-adapter.js';

import { MockGatewayAdapter } from './mock-adapter.js';
import type { GatewayAdapterOptions, GatewayAdapter } from './types.js';

export function createMockGateway(options?: GatewayAdapterOptions): GatewayAdapter {
  return new MockGatewayAdapter(options);
}
