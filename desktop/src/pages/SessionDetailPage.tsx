import type { Component } from 'solid-js';
import { useParams, useNavigate } from '@solidjs/router';
import { sessionStore } from '@/stores/session.js';
import { SessionDetail } from '@/modules/sessions/SessionDetail.js';
import { ROUTES } from '@/routes.js';

export const SessionDetailPage: Component = () => {
  const params = useParams<{ id: string }>();
  const navigate = useNavigate();

  const handleBranch = (id: string) => {
    navigate(`${ROUTES.SESSIONS}/${id}`);
  };

  const handleResume = (id: string) => {
    sessionStore.setActiveSession(id);
    navigate(ROUTES.HOME);
  };

  const handleDelete = () => {
    navigate(ROUTES.SESSIONS);
  };

  return (
    <SessionDetail
      sessionId={params.id}
      onBranch={handleBranch}
      onResume={handleResume}
      onDelete={handleDelete}
    />
  );
};

export default SessionDetailPage;
