import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { RenderedMessage } from '@/types/index.js';
import type { MessageBlock } from '@/types/index.js';

const NEAR_BOTTOM_THRESHOLD = 100;
const SCROLL_PAUSE_THRESHOLD = 80;
const ANONYMOUS_LIVE_TURN_KEY = 'live:anonymous';

export interface ScrollController {
  isNearBottom: () => boolean;
  userScrolledUp: () => boolean;
  setUserScrolledUp: (v: boolean) => void;
  unreadCount: () => number;
  setUnreadCount: (fn: (c: number) => number) => void;
  resetScrollState: () => void;
  handleScroll: () => void;
  handleViewportResize: () => void;
  scrollToBottom: (opts?: { force?: boolean; behavior?: ScrollBehavior }) => void;
  refs: { messagesEnd: HTMLDivElement | undefined; messageList: HTMLDivElement | undefined };
}

export function createScrollController(opts: {
  getMessages: () => RenderedMessage[];
  getLiveBlocks: () => MessageBlock[];
  getLiveTurnId?: () => string | null;
  getBlockingPromptActive: () => boolean;
}): ScrollController {
  const refs = { messagesEnd: undefined as HTMLDivElement | undefined, messageList: undefined as HTMLDivElement | undefined };
  let scrollRafId: number | undefined;
  let pendingScrollOpts: { force?: boolean; behavior?: ScrollBehavior } | undefined;
  let ignoreNextProgrammaticScroll = false;
  let programmaticScrollTimeout: ReturnType<typeof setTimeout> | undefined;
  let lastKnownScrollTop: number | undefined;
  let lastKnownClientHeight: number | undefined;
  let lastKnownScrollHeight: number | undefined;
  let countedLiveTurnKey: string | null = null;
  let pendingLiveMessageSkipKey: string | null = null;

  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [userScrolledUp, setUserScrolledUp] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [lastMessageCount, setLastMessageCount] = createSignal(0);

  const liveTurnKey = (live: MessageBlock[]): string | null => {
    if (live.length === 0) return null;
    const turnId = opts.getLiveTurnId?.();
    return turnId ? `turn:${turnId}` : ANONYMOUS_LIVE_TURN_KEY;
  };

  const messageMatchesLiveTurn = (message: RenderedMessage, liveKey: string): boolean => {
    if (message.role !== 'assistant') return false;
    if (liveKey === ANONYMOUS_LIVE_TURN_KEY) return true;
    if (message.turnId) return liveKey === `turn:${message.turnId}`;
    return false;
  };

  const countUnreadMessages = (messages: RenderedMessage[]): number => {
    if (!pendingLiveMessageSkipKey) return messages.length;
    let skippedLiveFinal = false;
    const count = messages.filter((message) => {
      if (!skippedLiveFinal && messageMatchesLiveTurn(message, pendingLiveMessageSkipKey!)) {
        skippedLiveFinal = true;
        return false;
      }
      return true;
    }).length;
    if (skippedLiveFinal) {
      pendingLiveMessageSkipKey = null;
      countedLiveTurnKey = null;
    }
    return count;
  };

  const markProgrammaticScroll = (el: HTMLDivElement, top: number) => {
    ignoreNextProgrammaticScroll = true;
    lastKnownScrollTop = top;
    lastKnownClientHeight = el.clientHeight;
    lastKnownScrollHeight = el.scrollHeight;
    setIsNearBottom(true);
    setUserScrolledUp(false);
    if (programmaticScrollTimeout !== undefined) clearTimeout(programmaticScrollTimeout);
    programmaticScrollTimeout = setTimeout(() => {
      ignoreNextProgrammaticScroll = false;
      programmaticScrollTimeout = undefined;
    }, 120);
  };

  const scrollListToBottomNow = (behavior: ScrollBehavior = 'auto') => {
    const el = refs.messageList;
    if (!el) return;
    const top = Math.max(0, el.scrollHeight - el.clientHeight);
    markProgrammaticScroll(el, top);
    if (typeof el.scrollTo === 'function') {
      el.scrollTo({ top, behavior });
    } else {
      el.scrollTop = top;
    }
  };

  const scrollToBottom = (scrollOpts?: { force?: boolean; behavior?: ScrollBehavior }) => {
    if (!refs.messageList) return;
    if (!scrollOpts?.force && userScrolledUp()) return;
    pendingScrollOpts = {
      force: pendingScrollOpts?.force || scrollOpts?.force,
      behavior: scrollOpts?.behavior ?? pendingScrollOpts?.behavior,
    };
    if (scrollRafId !== undefined) return;
    scrollRafId = requestAnimationFrame(() => {
      const next = pendingScrollOpts;
      scrollRafId = undefined;
      pendingScrollOpts = undefined;
      if (!next?.force && userScrolledUp()) return;
      scrollListToBottomNow(next?.behavior ?? 'auto');
    });
  };

  const scrollListToBottom = () => {
    scrollToBottom({ force: true, behavior: 'auto' });
  };

  const clearProgrammaticScrollGuard = () => {
    ignoreNextProgrammaticScroll = false;
    if (programmaticScrollTimeout !== undefined) {
      clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = undefined;
    }
  };

  const anchorAfterLayoutChange = (el: HTMLDivElement) => {
    lastKnownScrollTop = el.scrollTop;
    lastKnownClientHeight = el.clientHeight;
    lastKnownScrollHeight = el.scrollHeight;
    setIsNearBottom(true);
    setUserScrolledUp(false);
    scrollListToBottom();
  };

  onCleanup(() => {
    if (scrollRafId !== undefined) {
      cancelAnimationFrame(scrollRafId);
      scrollRafId = undefined;
      pendingScrollOpts = undefined;
    }
    if (programmaticScrollTimeout !== undefined) {
      clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = undefined;
    }
  });

  const handleScroll = () => {
    const el = refs.messageList;
    if (!el) return;
    const clientHeightChanged = lastKnownClientHeight !== undefined && el.clientHeight !== lastKnownClientHeight;
    const scrollHeightChanged = lastKnownScrollHeight !== undefined && el.scrollHeight !== lastKnownScrollHeight;
    if (ignoreNextProgrammaticScroll) {
      clearProgrammaticScrollGuard();
      if (!userScrolledUp() && (clientHeightChanged || scrollHeightChanged)) {
        anchorAfterLayoutChange(el);
        return;
      }
      lastKnownScrollTop = el.scrollTop;
      lastKnownClientHeight = el.clientHeight;
      lastKnownScrollHeight = el.scrollHeight;
      return;
    }
    if (!userScrolledUp() && (clientHeightChanged || scrollHeightChanged)) {
      anchorAfterLayoutChange(el);
      return;
    }
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const scrolledUp = lastKnownScrollTop === undefined || el.scrollTop < lastKnownScrollTop;
    lastKnownScrollTop = el.scrollTop;
    lastKnownClientHeight = el.clientHeight;
    lastKnownScrollHeight = el.scrollHeight;
    const near = distanceFromBottom < NEAR_BOTTOM_THRESHOLD;
    setIsNearBottom(near);
    if (near) {
      setUserScrolledUp(false);
      setUnreadCount(() => 0);
      countedLiveTurnKey = null;
      pendingLiveMessageSkipKey = null;
    } else if (scrolledUp && distanceFromBottom > SCROLL_PAUSE_THRESHOLD) {
      setUserScrolledUp(true);
    }
  };

  const handleViewportResize = () => {
    if (!refs.messageList) return;
    if (userScrolledUp()) return;
    scrollListToBottom();
  };

  createEffect(() => {
    const msgs = opts.getMessages();
    const prevCount = lastMessageCount();
    if (msgs.length > prevCount) {
      if (userScrolledUp()) {
        const unreadDelta = countUnreadMessages(msgs.slice(prevCount));
        if (unreadDelta > 0) {
          setUnreadCount((c) => c + unreadDelta);
        }
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
    const key = liveTurnKey(live);
    if (key) {
      if (userScrolledUp()) {
        if (countedLiveTurnKey === ANONYMOUS_LIVE_TURN_KEY && key !== countedLiveTurnKey) {
          countedLiveTurnKey = key;
          pendingLiveMessageSkipKey = key;
        } else if (countedLiveTurnKey !== key) {
          countedLiveTurnKey = key;
          pendingLiveMessageSkipKey = key;
          setUnreadCount((c) => c + 1);
        }
      } else {
        scrollToBottom();
        countedLiveTurnKey = null;
        pendingLiveMessageSkipKey = null;
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
    countedLiveTurnKey = null;
    pendingLiveMessageSkipKey = null;
    ignoreNextProgrammaticScroll = false;
    lastKnownScrollTop = undefined;
    lastKnownClientHeight = undefined;
    lastKnownScrollHeight = undefined;
    if (programmaticScrollTimeout !== undefined) {
      clearTimeout(programmaticScrollTimeout);
      programmaticScrollTimeout = undefined;
    }
  };

  return {
    isNearBottom,
    userScrolledUp,
    setUserScrolledUp,
    unreadCount,
    setUnreadCount,
    resetScrollState,
    handleScroll,
    handleViewportResize,
    scrollToBottom,
    refs,
  };
}
