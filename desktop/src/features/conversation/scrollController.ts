import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { RenderedMessage } from '@/types/index.js';
import type { MessageBlock } from '@/types/index.js';

const NEAR_BOTTOM_THRESHOLD = 100;
const SCROLL_PAUSE_THRESHOLD = 80;

export interface ScrollController {
  isNearBottom: () => boolean;
  userScrolledUp: () => boolean;
  setUserScrolledUp: (v: boolean) => void;
  unreadCount: () => number;
  setUnreadCount: (fn: (c: number) => number) => void;
  resetScrollState: () => void;
  handleScroll: () => void;
  scrollToBottom: (opts?: { force?: boolean; behavior?: ScrollBehavior }) => void;
  refs: { messagesEnd: HTMLDivElement | undefined; messageList: HTMLDivElement | undefined };
}

export function createScrollController(opts: {
  getMessages: () => RenderedMessage[];
  getLiveBlocks: () => MessageBlock[];
  getBlockingPromptActive: () => boolean;
}): ScrollController {
  const refs = { messagesEnd: undefined as HTMLDivElement | undefined, messageList: undefined as HTMLDivElement | undefined };
  let scrollRafId: number | undefined;
  let pendingScrollOpts: { force?: boolean; behavior?: ScrollBehavior } | undefined;

  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [userScrolledUp, setUserScrolledUp] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [lastMessageCount, setLastMessageCount] = createSignal(0);

  const scrollToBottom = (scrollOpts?: { force?: boolean; behavior?: ScrollBehavior }) => {
    if (!scrollOpts?.force && userScrolledUp()) return;
    pendingScrollOpts = scrollOpts;
    if (scrollRafId !== undefined) return;
    scrollRafId = requestAnimationFrame(() => {
      const next = pendingScrollOpts;
      scrollRafId = undefined;
      pendingScrollOpts = undefined;
      if (!next?.force && userScrolledUp()) return;
      refs.messagesEnd?.scrollIntoView({ behavior: next?.behavior ?? 'auto' });
    });
  };

  onCleanup(() => {
    if (scrollRafId !== undefined) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = undefined;
      pendingScrollOpts = undefined;
    }
  });

  const handleScroll = () => {
    const el = refs.messageList;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const near = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setIsNearBottom(near);
    if (near) {
      setUserScrolledUp(false);
      setUnreadCount(() => 0);
    } else if (distanceFromBottom > SCROLL_PAUSE_THRESHOLD) {
      setUserScrolledUp(true);
    }
  };

  createEffect(() => {
    const msgs = opts.getMessages();
    const prevCount = lastMessageCount();
    if (msgs.length > prevCount) {
      if (userScrolledUp()) {
        setUnreadCount((c) => c + (msgs.length - prevCount));
      } else {
        scrollToBottom();
      }
      setLastMessageCount(msgs.length);
    } else if (msgs.length > 0 && prevCount === 0) {
      setLastMessageCount(msgs.length);
      scrollToBottom();
    }
  });

  createEffect(() => {
    const live = opts.getLiveBlocks();
    if (live.length > 0) {
      if (userScrolledUp()) {
        setUnreadCount((c) => c + 1);
      } else {
        scrollToBottom();
      }
    }
  });

  createEffect(() => {
    if (opts.getBlockingPromptActive()) {
      scrollToBottom({ force: true });
    }
  });

  const resetScrollState = () => {
    setIsNearBottom(true);
    setUserScrolledUp(false);
    setUnreadCount(() => 0);
    setLastMessageCount(0);
  };

  return { isNearBottom, userScrolledUp, setUserScrolledUp, unreadCount, setUnreadCount, resetScrollState, handleScroll, scrollToBottom, refs };
}
