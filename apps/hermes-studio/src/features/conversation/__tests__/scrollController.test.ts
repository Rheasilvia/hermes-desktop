import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollController, type ScrollController } from '../scrollController';
import type { MessageBlock, RenderedMessage } from '@/types/index.js';

let disposeRoot: (() => void) | undefined;

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
  vi.restoreAllMocks();
});

const flushEffects = () => Promise.resolve();

function textBlock(id: string, content: string): MessageBlock {
  return { type: 'text', id, content };
}

function assistantMessage(id: string, turnId: string | null): RenderedMessage {
  return {
    id,
    sessionId: 'session-1',
    turnId,
    role: 'assistant',
    blocks: [textBlock(`${id}-block`, 'done')],
    timestamp: 1,
    tokenCount: null,
    finishReason: null,
    isStreaming: false,
    actions: [],
    toolName: null,
  };
}

function setupController(): {
  scroll: ScrollController;
  setMessages: (messages: RenderedMessage[]) => void;
  setLiveBlocks: (blocks: MessageBlock[]) => void;
  setLiveTurnId: (turnId: string | null) => void;
} {
  const [messages, setMessages] = createSignal<RenderedMessage[]>([]);
  const [liveBlocks, setLiveBlocks] = createSignal<MessageBlock[]>([]);
  const [liveTurnId, setLiveTurnId] = createSignal<string | null>(null);
  let scroll!: ScrollController;

  createRoot((dispose) => {
    disposeRoot = dispose;
    scroll = createScrollController({
      getMessages: messages,
      getLiveBlocks: liveBlocks,
      getLiveTurnId: liveTurnId,
      getBlockingPromptActive: () => false,
    });
  });

  return { scroll, setMessages, setLiveBlocks, setLiveTurnId };
}

describe('createScrollController unread count', () => {
  it('counts a streaming live turn once instead of once per live block update', async () => {
    const { scroll, setLiveBlocks, setLiveTurnId } = setupController();
    scroll.setUserScrolledUp(true);
    setLiveTurnId('turn-live');

    setLiveBlocks([textBlock('live-text', 'h')]);
    await flushEffects();
    expect(scroll.unreadCount()).toBe(1);

    for (let i = 0; i < 150; i += 1) {
      setLiveBlocks([textBlock('live-text', `hello ${i}`)]);
      await flushEffects();
    }

    expect(scroll.unreadCount()).toBe(1);
  });

  it('does not count the final assistant message again after counting its live turn', async () => {
    const { scroll, setMessages, setLiveBlocks, setLiveTurnId } = setupController();
    scroll.setUserScrolledUp(true);
    setLiveTurnId('turn-live');

    setLiveBlocks([textBlock('live-text', 'streaming')]);
    await flushEffects();
    expect(scroll.unreadCount()).toBe(1);

    batch(() => {
      setMessages([assistantMessage('assistant-final', 'turn-live')]);
      setLiveBlocks([]);
      setLiveTurnId(null);
    });
    await flushEffects();

    expect(scroll.unreadCount()).toBe(1);
  });

  it('does not recount a live turn when its turn id arrives after the first block', async () => {
    const { scroll, setLiveBlocks, setLiveTurnId } = setupController();
    scroll.setUserScrolledUp(true);

    setLiveBlocks([textBlock('live-text', 'streaming')]);
    await flushEffects();
    expect(scroll.unreadCount()).toBe(1);

    setLiveTurnId('turn-live');
    await flushEffects();

    expect(scroll.unreadCount()).toBe(1);
  });

  it('counts a later live turn after the previous final message is skipped', async () => {
    const { scroll, setMessages, setLiveBlocks, setLiveTurnId } = setupController();
    scroll.setUserScrolledUp(true);
    setLiveTurnId('turn-one');
    setLiveBlocks([textBlock('live-one', 'streaming')]);
    await flushEffects();

    batch(() => {
      setMessages([assistantMessage('assistant-one', 'turn-one')]);
      setLiveBlocks([]);
      setLiveTurnId(null);
    });
    await flushEffects();

    setLiveTurnId('turn-two');
    setLiveBlocks([textBlock('live-two', 'streaming again')]);
    await flushEffects();

    expect(scroll.unreadCount()).toBe(2);
  });
});

describe('createScrollController viewport resize anchoring', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
  });

  const attachScrollRefs = (scroll: ScrollController) => {
    const messageList = document.createElement('div');
    const messagesEnd = document.createElement('div');
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();
    messageList.scrollTo = scrollTo;
    messagesEnd.scrollIntoView = scrollIntoView;
    scroll.refs.messageList = messageList;
    scroll.refs.messagesEnd = messagesEnd;
    return { messageList, scrollIntoView, scrollTo };
  };

  const setScrollMetrics = (
    messageList: HTMLDivElement,
    metrics: { scrollHeight: number; scrollTop: number; clientHeight: number },
  ) => {
    Object.defineProperty(messageList, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
    Object.defineProperty(messageList, 'scrollTop', { configurable: true, value: metrics.scrollTop });
    Object.defineProperty(messageList, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  };

  it('keeps the latest message visible by directly scrolling the current list to bottom on composer resize', () => {
    const { scroll } = setupController();
    const { messageList, scrollIntoView, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 920, clientHeight: 100 });
    scroll.handleScroll();

    scroll.handleViewportResize();

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ top: 900, behavior: 'auto' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('does not steal scroll when composer growth happens while the user is reading history', () => {
    const { scroll } = setupController();
    const { messageList, scrollIntoView } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 100, clientHeight: 100 });
    scroll.handleScroll();

    scroll.handleViewportResize();

    expect(scroll.userScrolledUp()).toBe(true);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('coalesces repeated composer resize events into one bottom scroll', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    const requestAnimationFrameMock = vi.mocked(globalThis.requestAnimationFrame).mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const { scroll } = setupController();
    const { scrollTo } = attachScrollRefs(scroll);

    scroll.handleViewportResize();
    scroll.handleViewportResize();
    scroll.handleViewportResize();
    expect(requestAnimationFrameMock).toHaveBeenCalledTimes(1);
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](0);

    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('uses direct list anchoring when composer resize arrives while a bottom scroll is already queued', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.mocked(globalThis.requestAnimationFrame).mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const { scroll } = setupController();
    const { messageList, scrollIntoView, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });

    scroll.scrollToBottom();
    scroll.handleViewportResize();
    expect(rafCallbacks).toHaveLength(1);

    rafCallbacks[0](0);

    expect(scrollTo).toHaveBeenCalledWith({ top: 850, behavior: 'auto' });
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('honors a composer pin request even if the browser emits an upward scroll before the next frame', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.mocked(globalThis.requestAnimationFrame).mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const { scroll } = setupController();
    const { messageList, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    scroll.handleViewportResize();
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 700, clientHeight: 150 });
    scroll.handleScroll();
    expect(scroll.userScrolledUp()).toBe(true);

    rafCallbacks[0](0);

    expect(scrollTo).toHaveBeenCalledWith({ top: 850, behavior: 'auto' });
    expect(scroll.userScrolledUp()).toBe(false);
  });

  it('does not treat programmatic bottom anchoring scroll events as user scrolling up', () => {
    const { scroll } = setupController();
    const { messageList } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 920, clientHeight: 100 });
    scroll.handleScroll();

    scroll.handleViewportResize();
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 100, clientHeight: 100 });
    scroll.handleScroll();

    expect(scroll.userScrolledUp()).toBe(false);
  });

  it('keeps bottom anchoring when composer growth scrolls the list during the programmatic scroll guard', () => {
    const rafCallbacks: FrameRequestCallback[] = [];
    vi.mocked(globalThis.requestAnimationFrame).mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });
    const { scroll } = setupController();
    const { messageList, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    scroll.handleViewportResize();
    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks.shift()!(0);

    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 820, clientHeight: 60 });
    scroll.handleScroll();
    expect(rafCallbacks).toHaveLength(1);
    rafCallbacks.shift()!(1);

    expect(scroll.userScrolledUp()).toBe(false);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 940, behavior: 'auto' });
  });

  it('does not treat message-list height shrink from composer growth as user scrolling up', () => {
    const { scroll } = setupController();
    const { messageList, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 60 });
    scroll.handleScroll();

    expect(scroll.userScrolledUp()).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 940, behavior: 'auto' });
  });

  it('does not treat layout-induced upward scroll during composer growth as user scrolling up', () => {
    const { scroll } = setupController();
    const { messageList, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 820, clientHeight: 60 });
    scroll.handleScroll();

    expect(scroll.userScrolledUp()).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 940, behavior: 'auto' });
  });

  it('does not treat content growth with unchanged scrollTop as the user scrolling away from bottom', () => {
    const { scroll } = setupController();
    const { messageList, scrollTo } = attachScrollRefs(scroll);
    setScrollMetrics(messageList, { scrollHeight: 1000, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    setScrollMetrics(messageList, { scrollHeight: 1080, scrollTop: 850, clientHeight: 150 });
    scroll.handleScroll();

    expect(scroll.userScrolledUp()).toBe(false);
    expect(scrollTo).toHaveBeenCalledWith({ top: 930, behavior: 'auto' });
  });

  it('ignores composer resize when the current message list ref is missing', () => {
    const { scroll } = setupController();
    scroll.handleViewportResize();

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();
  });
});
