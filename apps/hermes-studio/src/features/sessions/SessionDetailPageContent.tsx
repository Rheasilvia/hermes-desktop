import type { Component } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import { sessionStore } from '@/stores/session.js';
import { SessionDetail } from '@/features/sessions/SessionDetail.js';
import { ROUTES } from '@/routes.js';

export const SessionDetailPageContent: Component<{ sessionId: string }> = (props) => {
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
      sessionId={props.sessionId}
      onBranch={handleBranch}
      onResume={handleResume}
      onDelete={handleDelete}
    />
  );
};
