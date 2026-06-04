"""In-process pub/sub event bus with thread→asyncio bridge.

Every subscriber gets its own asyncio.Queue.  Publish via `loop.call_soon_threadsafe`
so worker threads can safely push events without calling `asyncio.run()`.

Events are keyed by (session_id, seq, type, payload) — the bus does not inspect
the payload; it just fans out to all subscribers.

Usage:
    bus = EventBus()
    bus.subscribe(queue)          # attach a subscriber
    bus.publish(sid, seq, typ, payload)  # thread-safe (call from any thread)
    bus.unsubscribe(id(queue))    # detach when the subscriber leaves
"""

from __future__ import annotations

import asyncio
import logging
import queue
import threading
from typing import Any, Dict

log = logging.getLogger(__name__)

# Every event published on the bus has this shape.
Event = Dict[str, Any]  # {session_id, seq, type, payload}


class EventBus:
    """Single-process pub/sub for UI event streaming.

    Multi-window safe: each SSE connection subscribes its own queue.
    Thread-safe publishing: worker threads push to a thread-safe staging
    queue, and a periodic asyncio task flushes them to subscribers.

    Per-queue backpressure: if a subscriber's queue fills up, its oldest
    events are dropped (maxsize=256 by default).
    """

    def __init__(self) -> None:
        self._subscribers: Dict[int, asyncio.Queue[Event]] = {}
        self._loop: asyncio.AbstractEventLoop | None = None
        # Thread-safe staging queue for cross-thread publishes
        self._staging: queue.Queue[Event] = queue.Queue()
        self._flush_task: asyncio.Task | None = None
        self._flush_lock = threading.Lock()

    def _ensure_loop(self) -> asyncio.AbstractEventLoop:
        """Lazily capture the running event loop (called from asyncio thread)."""
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            pass  # not in an asyncio context
        if self._loop is None:
            raise RuntimeError("EventBus: no asyncio loop available")
        return self._loop

    def _start_flush_if_needed(self, loop: asyncio.AbstractEventLoop) -> None:
        with self._flush_lock:
            if self._flush_task is None or self._flush_task.done():
                self._flush_task = loop.create_task(self._flush_loop())

    async def _flush_loop(self) -> None:
        """Periodically drain the staging queue and dispatch to subscribers."""
        while True:
            try:
                # Drain as many events as are available
                while True:
                    try:
                        event = self._staging.get_nowait()
                        self._dispatch_to_subscribers(event)
                    except queue.Empty:
                        break
            except Exception:
                log.exception("event_bus flush error")
            await asyncio.sleep(0.05)

    def subscribe(self, q: asyncio.Queue[Event]) -> None:
        self._subscribers[id(q)] = q
        # Ensure the flush loop is started on the current event loop
        try:
            loop = asyncio.get_running_loop()
            self._start_flush_if_needed(loop)
        except RuntimeError:
            pass

    def unsubscribe(self, q: asyncio.Queue[Event]) -> None:
        self._subscribers.pop(id(q), None)

    def publish(
        self,
        session_id: str,
        seq: int,
        msg_type: str,
        payload: Dict[str, Any],
    ) -> None:
        """Publish an event.  Thread-safe — may be called from any thread.

        Events are placed in a thread-safe staging queue.  An asyncio flush
        task drains them and fans out to all subscribers.
        """
        event: Event = {
            "session_id": session_id,
            "seq": seq,
            "type": msg_type,
            "payload": payload,
        }
        self._staging.put(event)
        # Try to start the flush task if we're on the main thread
        try:
            loop = self._ensure_loop()
            self._start_flush_if_needed(loop)
        except RuntimeError:
            pass  # worker thread — flush task already started or will start on next subscribe

    def _dispatch_to_subscribers(self, event: Event) -> None:
        dead: list[int] = []
        for qid, q in list(self._subscribers.items()):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                # Drop oldest to make room
                try:
                    q.get_nowait()
                    q.task_done()
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(event)
                except asyncio.QueueFull:
                    pass
            except Exception:
                dead.append(qid)
        for qid in dead:
            self._subscribers.pop(qid, None)
