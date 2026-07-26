import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { CardOutput } from '../cards/CardOutput.js';
import { ToolCallTree } from '../ToolCallTree.js';
import { ToolCard } from '../ToolCard.js';
import { TurnActivityPanel } from '../TurnActivityPanel.js';
import { clampForDisplay, MAX_TOOL_RENDER_CHARS } from '../toolOutputClamp.js';

const oversized = (extra = 5_000) =>
  `${'x'.repeat(MAX_TOOL_RENDER_CHARS)}${'tail'.repeat(Math.ceil(extra / 4))}`;

describe('tool output display clamp', () => {
  it('passes bounded values through unchanged', () => {
    expect(clampForDisplay('hello')).toBe('hello');
    expect(clampForDisplay('x'.repeat(MAX_TOOL_RENDER_CHARS))).toHaveLength(MAX_TOOL_RENDER_CHARS);
  });

  it('truncates oversized values with the omitted count', () => {
    const value = oversized();
    const clamped = clampForDisplay(value);

    expect(clamped.length).toBeLessThan(value.length);
    expect(clamped.startsWith('x'.repeat(MAX_TOOL_RENDER_CHARS))).toBe(true);
    expect(clamped).toContain('5,000 more characters truncated');
    expect(clamped).toContain('Copy');
  });

  it('bounds ToolCard result rendering', () => {
    render(() => <ToolCard name="terminal" result={oversized()} status="complete" />);

    const rendered = screen.getByText(/more characters truncated/).parentElement?.textContent ?? '';
    expect(rendered).toContain('5,000 more characters truncated');
    expect(rendered).not.toContain('tailtailtailtail');
  });

  it('bounds ToolCallTree result summaries', () => {
    render(() => (
      <ToolCallTree
        rows={[{
          id: 'tool-1',
          name: 'terminal',
          status: 'complete',
          argumentPreview: null,
          resultSummary: oversized(),
          durationMs: 10,
        }]}
      />
    ));

    const rendered = screen.getByText(/more characters truncated/).textContent ?? '';
    expect(rendered).toContain('5,000 more characters truncated');
    expect(rendered).not.toContain('tailtailtailtail');
  });

  it('bounds CardOutput rendering', () => {
    render(() => <CardOutput text={oversized()} />);

    const rendered = screen.getByText(/more characters truncated/).textContent ?? '';
    expect(rendered).toContain('5,000 more characters truncated');
    expect(rendered).not.toContain('tailtailtailtail');
  });

  it('bounds expanded live tool result rendering', async () => {
    render(() => (
      <TurnActivityPanel
        toolRows={[{
          id: 'tool-1',
          name: 'terminal',
          status: 'complete',
          argumentPreview: null,
          resultSummary: oversized(),
          durationMs: 10,
        }]}
      />
    ));

    await fireEvent.click(screen.getByRole('button', { name: /1 tool completed\. Show details/ }));
    await fireEvent.click(screen.getByRole('button', { name: /terminal: Show result/ }));

    const rendered = screen.getByText(/more characters truncated/).textContent ?? '';
    expect(rendered).toContain('5,000 more characters truncated');
    expect(rendered).not.toContain('tailtailtailtail');
  });
});
