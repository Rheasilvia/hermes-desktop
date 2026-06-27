import type { RenderedMessage } from '@/types/index.js';

export const MESSAGE_VIRTUALIZATION_THRESHOLD = 250;
export const MESSAGE_VIRTUAL_ROW_HEIGHT = 144;
export const MESSAGE_VIRTUAL_OVERSCAN_ROWS = 20;
export const MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT = 720;

export interface VirtualMessageRange {
  messages: RenderedMessage[];
  startIndex: number;
  endIndex: number;
  beforeHeight: number;
  afterHeight: number;
  totalHeight: number;
  virtualized: boolean;
}

export function virtualizeMessages(
  messages: RenderedMessage[],
  scrollTop: number,
  viewportHeight: number,
  options: {
    threshold?: number;
    rowHeight?: number;
    overscanRows?: number;
    defaultToBottom?: boolean;
  } = {},
): VirtualMessageRange {
  const threshold = options.threshold ?? MESSAGE_VIRTUALIZATION_THRESHOLD;
  const rowHeight = Math.max(1, options.rowHeight ?? MESSAGE_VIRTUAL_ROW_HEIGHT);
  const overscanRows = Math.max(0, options.overscanRows ?? MESSAGE_VIRTUAL_OVERSCAN_ROWS);
  const safeViewportHeight = Math.max(0, viewportHeight || MESSAGE_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT);
  const totalHeight = messages.length * rowHeight;

  if (messages.length <= threshold) {
    return {
      messages,
      startIndex: 0,
      endIndex: messages.length,
      beforeHeight: 0,
      afterHeight: 0,
      totalHeight,
      virtualized: false,
    };
  }

  const bottomScrollTop = Math.max(0, totalHeight - safeViewportHeight);
  const safeScrollTop = options.defaultToBottom
    ? bottomScrollTop
    : Math.min(Math.max(0, scrollTop), bottomScrollTop);
  const firstVisible = Math.floor(safeScrollTop / rowHeight);
  const visibleCount = Math.max(1, Math.ceil(safeViewportHeight / rowHeight));
  const startIndex = Math.max(0, firstVisible - overscanRows);
  const endIndex = Math.min(messages.length, firstVisible + visibleCount + overscanRows);

  return {
    messages: messages.slice(startIndex, endIndex),
    startIndex,
    endIndex,
    beforeHeight: startIndex * rowHeight,
    afterHeight: Math.max(0, totalHeight - endIndex * rowHeight),
    totalHeight,
    virtualized: true,
  };
}
