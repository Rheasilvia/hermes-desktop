/**
 * Executes a lifecycle `action`-kind CommandResult against the frontend session
 * stores and router. Extracted from ChatView so the routing logic is unit
 * testable without rendering the whole conversation view. Display/list commands
 * are cards (rendered in the dock), not actions — only lifecycle commands
 * (new/branch/resume/title) flow through here.
 */

/**
 * Structural shape of an `action`-kind CommandResult. Mirrors the `action`
 * member of `CommandResult` in `@/services/gateway/types`; declared locally so
 * this helper stays free of the gateway import (D7 lint rule) and independently
 * testable. The real `CommandResult` is structurally assignable to this.
 */
export interface ActionResult {
  kind: 'action';
  action: 'new' | 'branch' | 'resume' | 'title';
  message?: string;
  name?: string;
}

/** Subset of `sessionStore` the action handler needs (kept structural for tests). */
export interface SessionStoreLike {
  readonly sessions: ReadonlyArray<{ id: string; title?: string | null }>;
  createSession(params: Record<string, unknown>): Promise<{ id: string } | null>;
  branchSession(id: string): Promise<{ id: string } | null>;
  resumeSession(id: string): Promise<boolean>;
  renameSession(id: string, title: string): Promise<boolean>;
}

export interface CommandActionDeps {
  /** The currently-active session id. */
  sessionId: string;
  /** Router navigation. */
  navigate: (path: string) => void;
  sessionStore: SessionStoreLike;
  /** Surface a short informational/error line (toast-like, transient). */
  notify: (message: string) => void;
}

const conversationPath = (id: string): string => `/conversation/${id}`;

export async function runCommandAction(result: ActionResult, deps: CommandActionDeps): Promise<void> {
  const { sessionId, navigate, sessionStore, notify } = deps;
  switch (result.action) {
    case 'new': {
      const meta = await sessionStore.createSession({});
      if (!meta) return;
      const title = (result.message ?? '').trim();
      if (title) await sessionStore.renameSession(meta.id, title);
      navigate(conversationPath(meta.id));
      return;
    }
    case 'branch': {
      const meta = await sessionStore.branchSession(sessionId);
      if (meta) navigate(conversationPath(meta.id));
      return;
    }
    case 'title': {
      const title = (result.message ?? '').trim();
      if (!title) {
        notify('Command error: usage: /title <name>');
        return;
      }
      await sessionStore.renameSession(sessionId, title);
      notify(`Session renamed to "${title}".`);
      return;
    }
    case 'resume': {
      const query = (result.message ?? '').trim().toLowerCase();
      const match = query
        ? sessionStore.sessions.find(
            (s) => s.id.toLowerCase() === query || (s.title ?? '').toLowerCase() === query,
          )
        : undefined;
      if (match) {
        await sessionStore.resumeSession(match.id);
        navigate(conversationPath(match.id));
      } else {
        notify(query ? `No session matches "${query}". Use /sessions to browse.` : 'Usage: /resume <id|title>');
      }
      return;
    }
  }
}
