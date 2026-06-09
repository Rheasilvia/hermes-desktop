import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AssistantMessage } from '../AssistantMessage';
import type { MessageBlock, ReasoningBlock, ToolCallBlock, ToolCallRow } from '@/types/index.js';

const voiceMocks = vi.hoisted(() => ({
  playSpeechText: vi.fn(),
}));

vi.mock('@/stores/settings.js', () => ({
  settingsStore: {
    get config() {
      return { tts: { provider: 'edge' }, voice: { auto_tts: false } };
    },
  },
}));

vi.mock('@/lib/voice/voice-playback.js', () => ({
  isVoicePlaybackActive: vi.fn(() => false),
  playSpeechText: voiceMocks.playSpeechText,
}));

describe('AssistantMessage live tool activity', () => {
  beforeEach(() => {
    voiceMocks.playSpeechText.mockReset();
    voiceMocks.playSpeechText.mockResolvedValue(true);
  });

  const tool = (id: string, name: string, status: ToolCallBlock['status'] = 'complete'): ToolCallBlock => ({
    type: 'tool_call',
    id: `block_${id}`,
    toolId: id,
    name,
    status,
    inputPreview: null,
    outputSummary: status === 'complete' ? `${name} done` : null,
    inlineDiff: null,
    durationMs: status === 'complete' ? 10 : null,
  });

  const reasoning = (id: string, content: string, isStreaming = true): ReasoningBlock => ({
    type: 'reasoning',
    id,
    content,
    isStreaming,
    tokenCount: null,
  });

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

  it('renders streaming thinking text and tool panels in chronological order', () => {
    const blocks: MessageBlock[] = [
      reasoning('reasoning_1', 'First thought.'),
      tool('tool_1', 'terminal'),
      reasoning('reasoning_2', 'Second thought.'),
      tool('tool_2', 'read_file', 'running'),
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} isStreaming />
    ));

    const renderedText = container.textContent ?? '';
    const firstThinking = renderedText.indexOf('First thought.');
    const firstTools = renderedText.indexOf('1 tool completed');
    const secondThinking = renderedText.indexOf('Second thought.');
    const secondTools = renderedText.lastIndexOf('0 tools completed');

    expect(firstThinking).toBeGreaterThanOrEqual(0);
    expect(firstTools).toBeGreaterThan(firstThinking);
    expect(secondThinking).toBeGreaterThan(firstTools);
    expect(secondTools).toBeGreaterThan(secondThinking);
    expect(screen.queryByText('Thinking...')).toBeNull();
  });

  it('preserves tool and text interleaving across separate tool groups', () => {
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

  it('merges adjacent completed tool groups separated only by empty thinking output', () => {
    const blocks: MessageBlock[] = [
      tool('tool_1', 'terminal'),
      reasoning('empty_reasoning', '   ', false),
      { type: 'text', id: 'empty_text', content: '\n\n' },
      tool('tool_2', 'read_file'),
      tool('tool_3', 'web_search'),
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} />
    ));

    const renderedText = container.textContent ?? '';
    expect(renderedText).toContain('3 tools completed');
    expect(renderedText).not.toContain('1 tool completed');
    expect(renderedText).not.toContain('2 tools completed');
  });

  it('keeps renderable thinking text as a separator between completed tool groups', () => {
    const blocks: MessageBlock[] = [
      tool('tool_1', 'terminal'),
      reasoning('visible_reasoning', 'I need to inspect the next area.', false),
      tool('tool_2', 'read_file'),
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} />
    ));

    const renderedText = container.textContent ?? '';
    const firstTools = renderedText.indexOf('1 tool completed');
    const thinking = renderedText.indexOf('I need to inspect the next area.');
    const secondTools = renderedText.lastIndexOf('1 tool completed');

    expect(firstTools).toBeGreaterThanOrEqual(0);
    expect(thinking).toBeGreaterThan(firstTools);
    expect(secondTools).toBeGreaterThan(thinking);
  });

  it('collapses prior work into one trace panel once final answer text follows tools', async () => {
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

  it('collapses completed thinking and tools before final answer into an expandable trace', async () => {
    const blocks: MessageBlock[] = [
      reasoning('reasoning_1', 'First thought.', false),
      tool('tool_1', 'terminal'),
      reasoning('reasoning_2', 'Second thought.', false),
      tool('tool_2', 'read_file'),
      { type: 'text', id: 'final_text', content: 'Final answer.' },
    ];

    const { container } = render(() => (
      <AssistantMessage blocks={blocks} />
    ));

    let renderedText = container.textContent ?? '';
    expect(renderedText).toContain('Work trace');
    expect(renderedText).toContain('Final answer.');
    expect(renderedText).not.toContain('First thought.');
    expect(renderedText).not.toContain('Second thought.');
    expect(renderedText).not.toContain('Thinking...');

    await fireEvent.click(screen.getByRole('button', { name: /Work trace/ }));

    renderedText = container.textContent ?? '';
    const firstThinking = renderedText.indexOf('First thought.');
    const firstTools = renderedText.indexOf('1 tool completed');
    const secondThinking = renderedText.indexOf('Second thought.');
    const secondTools = renderedText.lastIndexOf('1 tool completed');
    const finalAnswer = renderedText.indexOf('Final answer.');

    expect(firstThinking).toBeGreaterThan(renderedText.indexOf('Work trace'));
    expect(firstTools).toBeGreaterThan(firstThinking);
    expect(secondThinking).toBeGreaterThan(firstTools);
    expect(secondTools).toBeGreaterThan(secondThinking);
    expect(finalAnswer).toBeGreaterThan(secondTools);
    expect(screen.queryByText('Thinking...')).toBeNull();
  });

  it('does not remount completed tool cards when a later tool status changes', () => {
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

  it('shows read-aloud when TTS provider is configured without legacy tts.enabled', async () => {
    const { container } = render(() => (
      <AssistantMessage
        blocks={[{ type: 'text', id: 'answer', content: 'Final answer for speech.' }]}
        onAction={vi.fn()}
        isLast
      />
    ));

    await fireEvent.mouseEnter(container.firstElementChild!);
    const readAloud = screen.getByTitle('Read aloud');
    expect(readAloud).toBeDefined();

    await fireEvent.click(readAloud);
    expect(voiceMocks.playSpeechText).toHaveBeenCalledWith('Final answer for speech.', {
      source: 'read-aloud',
      messageId: 'answer',
    });
  });
});
