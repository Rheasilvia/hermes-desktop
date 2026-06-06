import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { createScrollController, type ScrollController } from '../scrollController';
import type { MessageBlock, RenderedMessage } from '@/types/index.js';

let disposeRoot: (() => void) | undefined;

afterEach(() => {
  disposeRoot?.();
  disposeRoot = undefined;
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
