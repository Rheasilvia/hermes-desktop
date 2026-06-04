import type { Component } from 'solid-js';
import { PermissionRequestCard } from './turn/PermissionRequestCard.js';

interface ApprovalCardProps {
  command: string;
  description: string;
  onAllow: () => void;
  onDeny: () => void;
  onAllowSession?: () => void;
}

export const ApprovalCard: Component<ApprovalCardProps> = (props) => {
  return (
    <PermissionRequestCard
      permission={{
        kind: 'approval',
        command: props.command,
        description: props.description,
        isPathApproval: Boolean(props.onAllowSession),
      }}
      onApprovalChoice={(choice) => {
        if (choice === 'deny') props.onDeny();
        else if (choice === 'session') props.onAllowSession?.();
        else props.onAllow();
      }}
      onMaskedSubmit={() => {}}
      onCancel={props.onDeny}
    />
  );
};
