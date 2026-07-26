import type { Component } from 'solid-js';

interface ToolMessageProps {
  toolName: string;
  content: string;
}

export const ToolMessage: Component<ToolMessageProps> = (props) => {
  return (
    <div
      style={{
        'font-family': 'var(--font-mono)',
        'font-size': 'var(--text-xs)',
        color: 'var(--color-on-surface-dim)',
        padding: 'var(--space-1) 0',
        'margin-bottom': 'var(--space-2)',
        'word-break': 'break-word',
      }}
    >
      <span
        style={{
          'font-weight': 'var(--weight-medium)',
          'margin-right': 'var(--space-2)',
          color: 'var(--color-on-surface-muted)',
        }}
      >
        {props.toolName}
      </span>
      {props.content}
    </div>
  );
};
