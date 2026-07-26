import type { Component } from 'solid-js';
import { useParams } from '@solidjs/router';
import { SessionDetailPageContent } from '@/features/sessions/SessionDetailPageContent.js';

export const SessionDetailPage: Component = () => {
  const params = useParams<{ id: string }>();
  return <SessionDetailPageContent sessionId={params.id} />;
};

export default SessionDetailPage;
