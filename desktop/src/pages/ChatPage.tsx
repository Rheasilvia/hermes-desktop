import type { Component } from 'solid-js';
import { onMount } from 'solid-js';
import { sessionStore } from '@/stores/session.js';
import { ChatView } from '@/modules/chat/index.js';

export const ChatPage: Component = () => {
  onMount(() => {
    if (!sessionStore.activeSessionId && sessionStore.sessions.length > 0) {
      sessionStore.setActiveSession(sessionStore.sessions[0].id);
    }
  });

  return (
    <ChatView sessionId={sessionStore.activeSessionId ?? undefined} />
  );
};

export default ChatPage;
