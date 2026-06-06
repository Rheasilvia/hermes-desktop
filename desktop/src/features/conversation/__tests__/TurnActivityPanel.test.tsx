import { fireEvent, render, screen, within } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnActivityPanel } from '../TurnActivityPanel';
import type { ToolCallRow } from '@/types/index.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('TurnActivityPanel live tool rows', () => {
  it('keeps live tools collapsed to a summary when a tool status updates', () => {
    const [rows, setRows] = createSignal<ToolCallRow[]>([
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'generating',
        argumentPreview: null,
        resultSummary: null,
        durationMs: null,
      },
    ]);

    const { container } = render(() => (
      <TurnActivityPanel toolRows={rows()} isLive />
    ));

    const summary = screen.getByLabelText('Tool activity summary');
    const count = within(summary).getByTestId('tool-completed-count');
    expect(summary.textContent).toContain('0 tools completed');
    expect(count.getAttribute('aria-label')).toBe('0');
    expect(container.querySelector('[class*="liveRow"]')).toBeNull();

    setRows([
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'complete',
        argumentPreview: null,
        resultSummary: 'read complete',
        durationMs: 42,
      },
    ]);

    expect(screen.getByLabelText('Tool activity summary')).toBe(summary);
    expect(within(summary).getByTestId('tool-completed-count')).toBe(count);
    expect(summary.textContent).toContain('1 tool completed');
    expect(count.getAttribute('aria-label')).toBe('1');
    expect(count.className).toContain('toolCountRolling');
    expect(container.querySelector('[class*="liveRow"]')).toBeNull();
  });

  it('increments the completed count without rendering tool rows when tools are appended', () => {
    const [rows, setRows] = createSignal<ToolCallRow[]>([
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'complete',
        argumentPreview: null,
        resultSummary: 'read complete',
        durationMs: 42,
      },
    ]);

    const { container } = render(() => (
      <TurnActivityPanel toolRows={rows()} isLive />
    ));

    const summary = screen.getByLabelText('Tool activity summary');
    const count = within(summary).getByTestId('tool-completed-count');
    expect(summary.textContent).toContain('1 tool completed');

    setRows([
      rows()[0],
      {
        id: 'tool_2',
        name: 'web_search',
        status: 'complete',
        argumentPreview: null,
        resultSummary: 'search complete',
        durationMs: 33,
      },
    ]);

    expect(screen.getByLabelText('Tool activity summary')).toBe(summary);
    expect(within(summary).getByTestId('tool-completed-count')).toBe(count);
    expect(summary.textContent).toContain('2 tools completed');
    expect(count.getAttribute('aria-label')).toBe('2');
    expect(container.querySelector('[class*="liveRow"]')).toBeNull();
  });

  it('keeps the live summary visual slots mounted when a different tool completes', () => {
    const [rows, setRows] = createSignal<ToolCallRow[]>([
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'complete',
        argumentPreview: null,
        resultSummary: 'read complete',
        durationMs: 42,
      },
    ]);

    render(() => (
      <TurnActivityPanel toolRows={rows()} isLive />
    ));

    const summary = screen.getByLabelText('Tool activity summary');
    const iconSlot = within(summary).getByTestId('tool-summary-icon-slot');
    const label = within(summary).getByTestId('tool-completed-label');
    const labelText = within(summary).getByTestId('tool-completed-text');
    const count = within(summary).getByTestId('tool-completed-count');

    setRows([
      rows()[0],
      {
        id: 'tool_2',
        name: 'terminal',
        status: 'complete',
        argumentPreview: 'pwd',
        resultSummary: 'done',
        durationMs: 19,
      },
    ]);

    expect(screen.getByLabelText('Tool activity summary')).toBe(summary);
    expect(within(summary).getByTestId('tool-summary-icon-slot')).toBe(iconSlot);
    expect(within(summary).getByTestId('tool-completed-label')).toBe(label);
    expect(within(summary).getByTestId('tool-completed-text')).toBe(labelText);
    expect(within(summary).getByTestId('tool-completed-count')).toBe(count);
    expect(summary.textContent).toContain('2 tools completed');
  });

  it('uses the same visual skeleton for live summary and completed details pill', () => {
    vi.useFakeTimers();
    const [live, setLive] = createSignal(true);
    const rows: ToolCallRow[] = [
      {
        id: 'tool_1',
        name: 'terminal',
        status: 'complete',
        argumentPreview: 'pwd',
        resultSummary: 'done',
        durationMs: 19,
      },
    ];

    render(() => (
      <TurnActivityPanel toolRows={rows} isLive={live()} />
    ));

    const liveSummary = screen.getByLabelText('Tool activity summary');
    const liveIconSlot = within(liveSummary).getByTestId('tool-summary-icon-slot');
    const liveActions = within(liveSummary).getByTestId('tool-summary-actions');
    expect(liveSummary.className).toContain('summaryRow');
    expect(liveSummary.textContent).toContain('1 tool completed');
    expect(liveActions.className).toContain('summaryActionsPlaceholder');

    setLive(false);
    vi.advanceTimersByTime(600);

    const pill = screen.getByTestId('turn-activity-pill');
    const pillIconSlot = within(pill).getByTestId('tool-summary-icon-slot');
    const pillActions = within(pill).getByTestId('tool-summary-actions');
    expect(pill.getAttribute('style') ?? '').toContain('display: flex');
    expect(pill.className).toContain('summaryRow');
    expect(pill.textContent).toContain('1 tool completed');
    expect(pillIconSlot.className).toBe(liveIconSlot.className);
    expect(pillActions.className).not.toContain('summaryActionsPlaceholder');
    expect(within(pill).getByRole('button', { name: 'Details' })).toBeTruthy();
  });

  it('keeps expanded tool status icon slots mounted when a row status changes', async () => {
    const [rows, setRows] = createSignal<ToolCallRow[]>([
      {
        id: 'tool_1',
        name: 'terminal',
        status: 'running',
        argumentPreview: 'pwd',
        resultSummary: 'still running',
        durationMs: null,
      },
    ]);

    render(() => (
      <TurnActivityPanel toolRows={rows()} />
    ));

    await fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    const iconSlot = screen.getByTestId('tool-status-icon-slot');

    setRows([
      {
        id: 'tool_1',
        name: 'terminal',
        status: 'complete',
        argumentPreview: 'pwd',
        resultSummary: 'done',
        durationMs: 19,
      },
    ]);

    expect(screen.getByTestId('tool-status-icon-slot')).toBe(iconSlot);
    expect(screen.getByRole('button', { name: /terminal: Show result/ })).toBeTruthy();
  });
});
