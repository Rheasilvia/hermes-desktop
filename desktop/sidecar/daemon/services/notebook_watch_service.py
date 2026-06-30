"""NotebookWatchService — file-watch → EventBus → SSE for notebook live preview.

Background-task pattern (backend-patterns):
  * Each session watches at most one notebook.
  * Watchdog events are debounced (atomic temp+rename writes collapse to one
    render) and the re-render runs off the FS-event thread so it never blocks
    watchdog's observer.
  * On change: re-render (refreshes the cache-aside entry in NotebookService)
    then persist via ``UIMessageService.append`` to get a durable seq, and
    publish ``notebook.changed`` on the EventBus. append+publish are paired so
    the SSE reconnect replay path stays consistent with every other emitter.
"""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path
from typing import Any

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from ..schemas.notebook import NotebookRenderPayload
from .event_bus import EventBus
from .notebook_service import NotebookService, NotebookServiceError
from .ui_message_service import UIMessageService
from .workspace_service import WorkspaceService, WorkspaceServiceError

log = logging.getLogger(__name__)

# Debounce window for collapsing rapid write events (atomic temp+rename emits
# a created/moved pair plus a modified or two).
DEBOUNCE_SECONDS = 0.4


class _WatchEntry:
    __slots__ = ("observer", "session_id", "relative_path", "abs_path", "cancel")

    def __init__(
        self,
        observer: Observer,
        session_id: str,
        relative_path: str,
        abs_path: Path,
        cancel: threading.Event,
    ) -> None:
        self.observer = observer
        self.session_id = session_id
        self.relative_path = relative_path
        self.abs_path = abs_path
        self.cancel = cancel


class NotebookWatchService:
    """Per-session notebook watcher that pushes `notebook.changed` events."""

    def __init__(
        self,
        *,
        workspace_service: WorkspaceService,
        notebook_service: NotebookService,
        ui_messages: UIMessageService,
        event_bus: EventBus,
    ) -> None:
        self._workspace = workspace_service
        self._notebooks = notebook_service
        self._ui_messages = ui_messages
        self._bus = event_bus
        self._entries: dict[str, _WatchEntry] = {}
        self._lock = threading.Lock()

    def watch(self, session_id: str, relative_path: str) -> str:
        """Start or replace the watcher for a session. Returns the resolved path.

        Re-resolves the path through the workspace policy each time so a session
        that switched workspaces cannot keep watching a stale/out-of-scope file.
        """
        target = self._workspace.resolve_abs_path(session_id, relative_path, access="read")
        # Stop any existing watcher for this session first.
        self._stop_locked(session_id)

        cancel = threading.Event()
        handler = _NotebookHandler(
            service=self,
            session_id=session_id,
            relative_path=relative_path,
            abs_path=target,
            cancel=cancel,
        )
        observer = Observer()
        # Watch the parent directory (not the file) so rename-based atomic writes
        # (write-to-temp + rename) are observed reliably across platforms.
        observer.schedule(handler, str(target.parent), recursive=False)
        observer.start()

        with self._lock:
            self._entries[session_id] = _WatchEntry(
                observer=observer,
                session_id=session_id,
                relative_path=relative_path,
                abs_path=target,
                cancel=cancel,
            )
        return relative_path

    def clear(self, session_id: str) -> None:
        with self._lock:
            self._stop_locked(session_id)

    def shutdown(self) -> None:
        """Stop all watchers. Called from the app lifespan shutdown handler."""
        with self._lock:
            for session_id in list(self._entries.keys()):
                self._stop_locked(session_id)

    # Internal ---------------------------------------------------------------

    def _stop_locked(self, session_id: str) -> None:
        entry = self._entries.pop(session_id, None)
        if entry is None:
            return
        entry.cancel.set()
        try:
            entry.observer.stop()
        except Exception:
            log.exception("notebook watcher: failed to stop observer for %s", session_id)
        try:
            entry.observer.join(timeout=2.0)
        except Exception:
            log.exception("notebook watcher: observer join failed for %s", session_id)

    def _emit(self, session_id: str, relative_path: str) -> None:
        """Re-render and publish a `notebook.changed` event (debounced caller)."""
        try:
            render = self._notebooks.render_notebook(session_id, relative_path)
        except (NotebookServiceError, WorkspaceServiceError) as exc:
            log.info("notebook watcher render failed for %s: %s", session_id, exc)
            return
        except Exception:
            log.exception("notebook watcher render failed for %s", session_id)
            return

        payload = NotebookRenderPayload(
            path=render.path,
            cells=render.cells,
            mtime=render.mtime,
            size=render.size,
            truncated=render.truncated,
        )
        payload_dict = payload.model_dump()
        # append+publish are paired: append gives a durable seq for SSE replay.
        seq = self._ui_messages.append(session_id, "notebook.changed", payload_dict)
        try:
            self._bus.publish(session_id, seq, "notebook.changed", payload_dict)
        except Exception:
            log.exception("notebook watcher: failed to publish event for %s", session_id)


class _NotebookHandler(FileSystemEventHandler):
    """Debounces filesystem events for one notebook path."""

    def __init__(
        self,
        service: NotebookWatchService,
        session_id: str,
        relative_path: str,
        abs_path: Path,
        cancel: threading.Event,
    ) -> None:
        self._service = service
        self._session_id = session_id
        self._relative_path = relative_path
        self._abs_path = abs_path
        self._cancel = cancel
        self._target_name = abs_path.name
        self._last_fire = 0.0
        self._debounce_lock = threading.Lock()
        self._pending_thread: threading.Thread | None = None

    def _maybe_schedule(self) -> None:
        """Coalesce events: only one delayed render is ever pending."""
        if self._cancel.is_set():
            return
        with self._debounce_lock:
            now = time.monotonic()
            self._last_fire = now
            if self._pending_thread is not None and self._pending_thread.is_alive():
                return
            self._pending_thread = threading.Thread(
                target=self._debounced_emit, name="notebook-watch", daemon=True
            )
            self._pending_thread.start()

    def _debounced_emit(self) -> None:
        """Wait for quiet, then emit once. Runs off the watchdog event thread."""
        # Loop until the fire-time stops advancing (quiet for DEBOUNCE_SECONDS).
        while not self._cancel.is_set():
            time.sleep(DEBOUNCE_SECONDS)
            with self._debounce_lock:
                if time.monotonic() - self._last_fire >= DEBOUNCE_SECONDS:
                    break
        if self._cancel.is_set():
            return
        self._service._emit(self._session_id, self._relative_path)
        # Clear the pending handle under lock so the next FS event spawns a
        # fresh worker. If a new event arrived during/after emit, _maybe_schedule
        # sees None here and spawns a new thread to render that latest write.
        with self._debounce_lock:
            self._pending_thread = None

    def _matches(self, src_path: str | None) -> bool:
        if not src_path:
            return False
        try:
            return Path(src_path).resolve() == self._abs_path
        except Exception:
            return Path(src_path).name == self._target_name

    def on_modified(self, event: Any) -> None:  # noqa: D401
        if event.is_directory or not self._matches(getattr(event, "src_path", None)):
            return
        self._maybe_schedule()

    def on_created(self, event: Any) -> None:
        if event.is_directory or not self._matches(getattr(event, "src_path", None)):
            return
        self._maybe_schedule()

    def on_moved(self, event: Any) -> None:
        # Atomic writes (temp + rename) surface as on_moved with dest_path.
        dest = getattr(event, "dest_path", None)
        if event.is_directory or not self._matches(dest):
            return
        self._maybe_schedule()
