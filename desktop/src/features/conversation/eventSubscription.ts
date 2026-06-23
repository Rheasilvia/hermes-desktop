import { onMount, onCleanup } from 'solid-js';
import type {
  MessageDeltaPayload, MessageCompletePayload, ReasoningDeltaPayload,
  PlanDeltaPayload, PlanCompletePayload,
  ToolStartPayload, ToolProgressPayload, ToolCompletePayload,
  ToolGeneratingPayload, ToolErrorPayload,
  ApprovalRequestPayload, ClarifyRequestPayload,
  SudoRequestPayload, SecretRequestPayload,
  BackgroundCompletePayload, BtwCompletePayload,
  SubagentStartPayload, SubagentProgressPayload,
  SubagentCompletePayload, SubagentToolPayload, SubagentErrorPayload,
  ErrorPayload, TurnInterruptedPayload,
} from '@/types/gateway.js';
import type { GatewayAdapter } from '@/services/gateway/types.js';
import { chatStore } from '@/stores/chat.js';
import { backgroundTaskStore } from '@/stores/background-tasks.js';
import { delegationStore } from '@/stores/delegation.js';
import { sessionStore } from '@/stores/session.js';
import { nativeNotifications } from '@/services/notifications/native-notifications.js';

// Error codes emitted by B1 classifier that map to a provider-setup action
const PROVIDER_SETUP_CODES = new Set(['provider_auth', 'model_not_found']);
// Fallback string matching for backends that haven't been updated yet
const PROVIDER_SETUP_PATTERNS = /no provider|api.?key|authentication|unauthorized|invalid.*key/i;

function buildErrorMessage(p: ErrorPayload): string {
  // B1 structured errors arrive with a code field; older backends send plain message
  if (p.code && PROVIDER_SETUP_CODES.has(String(p.code))) {
    return p.message;
  }
  return p.message;
}

function isProviderSetupError(p: ErrorPayload): boolean {
  if (p.code && PROVIDER_SETUP_CODES.has(String(p.code))) return true;
  return PROVIDER_SETUP_PATTERNS.test(p.message);
}

export function useGatewayEvents(opts: {
  getGateway: () => GatewayAdapter | null;
}) {
  // All handlers use p.session_id from the event payload — not a closed-over
  // session from the component. This ensures events are routed to the correct
  // session even when the user has multiple sessions open or switches between them.
  const onMessageDelta = (p: MessageDeltaPayload) => chatStore.handleDelta(p.session_id, p);
  const onPlanDelta = (p: PlanDeltaPayload) => chatStore.handlePlanDelta(p.session_id, p);
  const onPlanComplete = (p: PlanCompletePayload) => chatStore.handlePlanComplete(p.session_id, p);
  const onMessageComplete = (p: MessageCompletePayload) => {
    chatStore.handleMessageComplete(p.session_id, p);
    nativeNotifications.turnDone(p.session_id);
  };
  const onReasoningDelta = (p: ReasoningDeltaPayload) => chatStore.handleReasoningDelta(p.session_id, p);
  const onToolStart = (p: ToolStartPayload) => chatStore.handleToolStart(p.session_id, p);
  const onToolProgress = (p: ToolProgressPayload) => chatStore.handleToolProgress(p.session_id, p);
  const onToolComplete = (p: ToolCompletePayload) => chatStore.handleToolComplete(p.session_id, p);
  const onToolGenerating = (p: ToolGeneratingPayload) => chatStore.handleToolGenerating(p.session_id, p);
  const onToolError = (p: ToolErrorPayload) => chatStore.handleToolError(p.session_id, p);
  const onApprovalRequest = (p: ApprovalRequestPayload) => {
    chatStore.handleApprovalRequest(p.session_id, p);
    nativeNotifications.approval(p.session_id, p.command, p.description);
  };
  const onSudoRequest = (p: SudoRequestPayload) => chatStore.handleSudoRequest(p.session_id, p);
  const onSecretRequest = (p: SecretRequestPayload) => chatStore.handleSecretRequest(p.session_id, p);
  const onClarifyRequest = (p: ClarifyRequestPayload) => chatStore.handleClarifyRequest(p.session_id, p);
  const onBackgroundComplete = (p: BackgroundCompletePayload) => {
    backgroundTaskStore.handleComplete(p);
    nativeNotifications.backgroundDone(undefined, 'Background task complete');
  };
  const onBtwComplete = (p: BtwCompletePayload) => backgroundTaskStore.handleBtwComplete(p);
  const onSubagentStart = (p: SubagentStartPayload) => delegationStore.handleStart(p);
  const onSubagentProgress = (p: SubagentProgressPayload) => delegationStore.handleProgress(p);
  const onSubagentComplete = (p: SubagentCompletePayload) => delegationStore.handleComplete(p);
  const onSubagentTool = (p: SubagentToolPayload) => delegationStore.handleTool(p);
  const onSubagentError = (p: SubagentErrorPayload) => delegationStore.handleError(p);
  const onTurnInterrupted = (p: TurnInterruptedPayload) => chatStore.handleTurnInterrupted(p.session_id, p);

  const onError = (p: ErrorPayload) => {
    const sid = p.session_id || sessionStore.activeSessionId;
    if (!sid) return;
    const action = isProviderSetupError(p)
      ? { label: 'Open model settings', route: '/settings/model' }
      : null;
    const displayMessage = p.hint
      ? `${buildErrorMessage(p)}\n${p.hint}`
      : buildErrorMessage(p);
    chatStore.handleError(sid, { ...p, message: displayMessage }, action);
    nativeNotifications.turnError(sid, displayMessage);
  };

  onMount(() => {
    const gw = opts.getGateway();
    if (!gw) return;
    gw.on('message.delta', onMessageDelta);
    gw.on('plan.delta', onPlanDelta);
    gw.on('plan.complete', onPlanComplete);
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
    gw.on('turn.interrupted', onTurnInterrupted);
    gw.on('error', onError);
  });

  onCleanup(() => {
    const gw = opts.getGateway();
    if (!gw) return;
    gw.off('message.delta', onMessageDelta);
    gw.off('plan.delta', onPlanDelta);
    gw.off('plan.complete', onPlanComplete);
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
    gw.off('turn.interrupted', onTurnInterrupted);
    gw.off('error', onError);
  });
}
