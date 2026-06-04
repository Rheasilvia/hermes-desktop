import { render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { TurnActivityPanel } from '../TurnActivityPanel';
import type { ToolCallRow } from '@/types/index.js';

describe('TurnActivityPanel live tool rows', () => {
  it('keeps existing row DOM nodes when a tool status updates', () => {
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

    const firstRow = container.querySelector('[class*="liveRow"]');
    expect(firstRow).not.toBeNull();

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

    const updatedFirstRow = container.querySelector('[class*="liveRow"]');
    expect(updatedFirstRow).toBe(firstRow);
    expect(updatedFirstRow?.getAttribute('style') ?? '').not.toContain('animation-delay');
  });

  it('keeps the first row DOM node when a second tool is appended', () => {
    const [rows, setRows] = createSignal<ToolCallRow[]>([
      {
        id: 'tool_1',
        name: 'read_file',
        status: 'running',
        argumentPreview: null,
        resultSummary: null,
        durationMs: null,
      },
    ]);

    const { container } = render(() => (
      <TurnActivityPanel toolRows={rows()} isLive />
    ));

    const firstRow = container.querySelector('[class*="liveRow"]');
    expect(firstRow).not.toBeNull();

    setRows([
      rows()[0],
      {
        id: 'tool_2',
        name: 'web_search',
        status: 'generating',
        argumentPreview: null,
        resultSummary: null,
        durationMs: null,
      },
    ]);

    const liveRows = container.querySelectorAll('[class*="liveRow"]');
    expect(liveRows).toHaveLength(2);
    expect(liveRows[0]).toBe(firstRow);
  });
});
