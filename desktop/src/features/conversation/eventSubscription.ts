import { onMount, onCleanup } from 'solid-js';
import type {
  MessageDeltaPayload, MessageCompletePayload, ReasoningDeltaPayload,
  ToolStartPayload, ToolProgressPayload, ToolCompletePayload,
  ToolGeneratingPayload, ToolErrorPayload,
  ApprovalRequestPayload, ClarifyRequestPayload,
  SudoRequestPayload, SecretRequestPayload,
  BackgroundCompletePayload, BtwCompletePayload,
  SubagentStartPayload, SubagentProgressPayload,
  SubagentCompletePayload, SubagentToolPayload, SubagentErrorPayload,
} from '@/types/gateway.js';
import type { GatewayAdapter } from '@/services/gateway/types.js';
import { chatStore } from '@/stores/chat.js';
import { backgroundTaskStore } from '@/stores/background-tasks.js';
import { delegationStore } from '@/stores/delegation.js';

export function useGatewayEvents(opts: {
  sessionId: () => string;
  getGateway: () => GatewayAdapter | null;
}) {
  const sid = opts.sessionId;

  const onMessageDelta = (p: MessageDeltaPayload) => chatStore.handleDelta(sid(), p);
  const onMessageComplete = (p: MessageCompletePayload) => chatStore.handleMessageComplete(sid(), p);
  const onReasoningDelta = (p: ReasoningDeltaPayload) => chatStore.handleReasoningDelta(sid(), p.text);
  const onToolStart = (p: ToolStartPayload) => chatStore.handleToolStart(sid(), p);
  const onToolProgress = (p: ToolProgressPayload) => chatStore.handleToolProgress(sid(), p);
  const onToolComplete = (p: ToolCompletePayload) => chatStore.handleToolComplete(sid(), p);
  const onToolGenerating = (p: ToolGeneratingPayload) => chatStore.handleToolGenerating(sid(), p);
  const onToolError = (p: ToolErrorPayload) => chatStore.handleToolError(sid(), p);
  const onApprovalRequest = (p: ApprovalRequestPayload) => chatStore.handleApprovalRequest(sid(), p);
  const onSudoRequest = (p: SudoRequestPayload) => chatStore.handleSudoRequest(sid(), p);
  const onSecretRequest = (p: SecretRequestPayload) => chatStore.handleSecretRequest(sid(), p);
  const onClarifyRequest = (p: ClarifyRequestPayload) => chatStore.handleClarifyRequest(sid(), p);
  const onBackgroundComplete = (p: BackgroundCompletePayload) => backgroundTaskStore.handleComplete(p);
  const onBtwComplete = (p: BtwCompletePayload) => backgroundTaskStore.handleBtwComplete(p);
  const onSubagentStart = (p: SubagentStartPayload) => delegationStore.handleStart(p);
  const onSubagentProgress = (p: SubagentProgressPayload) => delegationStore.handleProgress(p);
  const onSubagentComplete = (p: SubagentCompletePayload) => delegationStore.handleComplete(p);
  const onSubagentTool = (p: SubagentToolPayload) => delegationStore.handleTool(p);
  const onSubagentError = (p: SubagentErrorPayload) => delegationStore.handleError(p);

  onMount(() => {
    const gw = opts.getGateway();
    if (!gw) return;
    gw.on('message.delta', onMessageDelta);
    gw.on('message.complete', onMessageComplete);
    gw.on('reasoning.delta', onReasoningDelta);
    gw.on('tool.start', onToolStart);
    gw.on('tool.progress', onToolProgress);
    gw.on('tool.complete', onToolComplete);
    gw.on('tool.generating', onToolGenerating);
    gw.on('tool.error', onToolError);
    gw.on('approval.request', onApprovalRequest);
    gw.on('sudo.request', onSudoRequest);
    gw.on('secret.request', onSecretRequest);
    gw.on('clarify.request', onClarifyRequest);
    gw.on('background.complete', onBackgroundComplete);
    gw.on('btw.complete', onBtwComplete);
    gw.on('subagent.start', onSubagentStart);
    gw.on('subagent.progress', onSubagentProgress);
    gw.on('subagent.complete', onSubagentComplete);
    gw.on('subagent.tool', onSubagentTool);
    gw.on('subagent.error', onSubagentError);
  });

  onCleanup(() => {
    const gw = opts.getGateway();
    if (!gw) return;
    gw.off('message.delta', onMessageDelta);
    gw.off('message.complete', onMessageComplete);
    gw.off('reasoning.delta', onReasoningDelta);
    gw.off('tool.start', onToolStart);
    gw.off('tool.progress', onToolProgress);
    gw.off('tool.complete', onToolComplete);
    gw.off('tool.generating', onToolGenerating);
    gw.off('tool.error', onToolError);
    gw.off('approval.request', onApprovalRequest);
    gw.off('sudo.request', onSudoRequest);
    gw.off('secret.request', onSecretRequest);
    gw.off('clarify.request', onClarifyRequest);
    gw.off('background.complete', onBackgroundComplete);
    gw.off('btw.complete', onBtwComplete);
    gw.off('subagent.start', onSubagentStart);
    gw.off('subagent.progress', onSubagentProgress);
    gw.off('subagent.complete', onSubagentComplete);
    gw.off('subagent.tool', onSubagentTool);
    gw.off('subagent.error', onSubagentError);
  });
}
