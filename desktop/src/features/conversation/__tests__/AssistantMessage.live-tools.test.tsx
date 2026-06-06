import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { AssistantMessage } from '../AssistantMessage';
import type { MessageBlock, ToolCallBlock, ToolCallRow } from '@/types/index.js';

describe('AssistantMessage live tool activity', () => {
  it('keeps live tool activity collapsed to a summary while the assistant turn is still streaming', () => {
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

    const summary = screen.getByLabelText('Tool activity summary');
    expect(summary.parentElement?.getAttribute('style') ?? '').toContain('display: flex');
    expect(summary.textContent).toContain('1 tool completed');
    expect(screen.queryByLabelText('Live tool activity')).toBeNull();
  });

  it('preserves tool and text interleaving across separate tool groups', () => {
    const tool = (id: string, name: string): ToolCallBlock => ({
      type: 'tool_call',
      id: `block_${id}`,
      toolId: id,
      name,
      status: 'complete',
      inputPreview: null,
      outputSummary: null,
      inlineDiff: null,
      durationMs: 10,
    });
    const blocks: MessageBlock[] = [
      tool('tool_1', 'terminal'),
      { type: 'text', id: 'text_1', content: 'Text after the first tool.' },
      tool('tool_2', 'read_file'),
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} />
    ));

    const renderedText = container.textContent ?? '';
    const firstToolPanel = renderedText.indexOf('1 tool completed');
    const middleText = renderedText.indexOf('Text after the first tool.');
    const secondToolPanel = renderedText.lastIndexOf('1 tool completed');

    expect(firstToolPanel).toBeGreaterThanOrEqual(0);
    expect(middleText).toBeGreaterThan(firstToolPanel);
    expect(secondToolPanel).toBeGreaterThan(middleText);
  });

  it('collapses prior work into one trace panel once final answer text follows tools', async () => {
    const tool = (id: string, name: string): ToolCallBlock => ({
      type: 'tool_call',
      id: `block_${id}`,
      toolId: id,
      name,
      status: 'complete',
      inputPreview: null,
      outputSummary: null,
      inlineDiff: null,
      durationMs: 10,
    });
    const blocks: MessageBlock[] = [
      { type: 'text', id: 'text_before', content: 'Before tools.' },
      tool('tool_1', 'terminal'),
      tool('tool_2', 'read_file'),
      tool('tool_3', 'read_file'),
      { type: 'text', id: 'text_after', content: 'After tools.' },
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} />
    ));

    const renderedText = container.textContent ?? '';
    expect(renderedText).toContain('Work trace');
    expect(renderedText).toContain('3 tools');
    expect(renderedText).toContain('After tools.');
    expect(renderedText).not.toContain('Before tools.');
    expect(renderedText).not.toContain('3 tools completed');

    await fireEvent.click(screen.getByRole('button', { name: /Work trace/ }));
    const expandedText = container.textContent ?? '';
    expect(expandedText.indexOf('Before tools.')).toBeGreaterThan(expandedText.indexOf('Work trace'));
    expect(expandedText.indexOf('3 tools completed')).toBeGreaterThan(expandedText.indexOf('Before tools.'));
    expect(expandedText.indexOf('After tools.')).toBeGreaterThan(expandedText.indexOf('3 tools completed'));
    expect(expandedText).not.toContain('1 tool completed');
  });

  it('does not remount completed tool cards when a later tool status changes', () => {
    const tool = (id: string, name: string, status: ToolCallBlock['status']): ToolCallBlock => ({
      type: 'tool_call',
      id: `block_${id}`,
      toolId: id,
      name,
      status,
      inputPreview: null,
      outputSummary: null,
      inlineDiff: null,
      durationMs: status === 'complete' ? 10 : null,
    });
    const [blocks, setBlocks] = createSignal<MessageBlock[]>([
      tool('tool_1', 'terminal', 'complete'),
      { type: 'text', id: 'text_1', content: 'First note.' },
      tool('tool_2', 'read_file', 'complete'),
      { type: 'text', id: 'text_2', content: 'Second note.' },
      tool('tool_3', 'read_file', 'running'),
    ]);

    const { container } = render(() => (
      <AssistantMessage blocks={blocks()} isStreaming />
    ));

    const completedCards = () =>
      Array.from(container.querySelectorAll('[data-testid="turn-activity-pill"]'))
        .filter((node) => node.textContent?.includes('1 tool completed'));
    const before = completedCards();

    setBlocks([
      blocks()[0],
      blocks()[1],
      blocks()[2],
      blocks()[3],
      tool('tool_3', 'read_file', 'complete'),
    ]);

    const after = completedCards();
    expect(after).toHaveLength(3);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(container.textContent).toContain('Second note.');
  });
});
