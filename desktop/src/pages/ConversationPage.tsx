import type { Component } from 'solid-js';
import { useParams } from '@solidjs/router';
import { ChatView } from '@/modules/conversation/ChatView.js';

export const ConversationPage: Component = () => {
  const params = useParams<{ id: string }>();
  const sessionId = () => params.id;

  return (
    <ChatView sessionId={sessionId()} />
  );
};

export default ConversationPage;
