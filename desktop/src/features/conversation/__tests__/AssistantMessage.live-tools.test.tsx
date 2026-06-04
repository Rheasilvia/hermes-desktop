import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { AssistantMessage } from '../AssistantMessage';
import type { ToolCallRow } from '@/types/index.js';

describe('AssistantMessage live tool activity', () => {
  it('keeps the active tool list open while the assistant turn is still streaming', () => {
    const rows: ToolCallRow[] = [
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'complete',
        argumentPreview: null,
        resultSummary: 'done',
        durationMs: 25,
      },
    ];

    render(() => (
      <AssistantMessage
        blocks={[]}
        isStreaming
        liveToolRows={rows}
      />
    ));

    const liveList = screen.getByLabelText('Live tool activity');
    expect(liveList.parentElement?.getAttribute('style') ?? '').toContain('display: flex');
  });
});
