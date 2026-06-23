"""SSE event stream endpoint.

GET /desktop/api/events/stream?token=...
    Long-lived Server-Sent Events connection.  Multiplexed across all
    sessions — every event carries `session_id` so the client can filter.

    Format:
        event: {type}
        data: {"session_id":"...","seq":N,"payload":{...}}

    Keepalive every 15s:
        : keepalive

    Headers:
        X-Accel-Buffering: no   (disable nginx proxy buffering)
        Cache-Control: no-cache
        Connection: keep-alive
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import AsyncGenerator

from fastapi import APIRouter, Query, Request
from starlette.responses import StreamingResponse

log = logging.getLogger(__name__)

router = APIRouter()
KEEPALIVE_INTERVAL = 15  # seconds


async def _replay_pending_approvals() -> AsyncGenerator[str, None]:
    """Yield SSE events for any pending path approvals in ui_messages.

    Called on SSE reconnect so the frontend can restore ApprovalCard state.
    """
    try:
        from ..db.connection import connect as desktop_connect
        from pathlib import Path
        import os

        hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        conn = desktop_connect(hermes_home)
        rows = conn.execute(
            "SELECT session_id, payload_json FROM ui_messages "
            "WHERE type = 'pending_approval' AND json_extract(payload_json, '$.status') = 'pending'"
        ).fetchall()
        conn.close()

        for row in rows:
            payload = json.loads(row["payload_json"])
            data = json.dumps({
                "session_id": row["session_id"],
                "seq": 0,
                "type": "approval.request",
                "payload": {
                    "path": payload.get("path", ""),
                    "operation": payload.get("operation", ""),
                    "command": payload.get("command", ""),
                    "description": payload.get("description", ""),
                    "is_path_approval": True,
                },
            }, ensure_ascii=False)
            yield f"data: {data}\n\n"
    except Exception:
        log.debug("Failed to replay pending approvals", exc_info=True)


async def _replay_pending_user_inputs() -> AsyncGenerator[str, None]:
    """Yield SSE events for pending durable request_user_input prompts."""
    try:
        from pathlib import Path
        import os

        from ..db.user_input_prompts import list_pending

        hermes_home = Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))
        for prompt in list_pending(hermes_home):
            payload = {
                "request_id": prompt["request_id"],
                "turn_id": prompt["turn_id"],
                "questions": prompt.get("questions") or [],
                "status": "pending",
            }
            data = json.dumps({
                "session_id": prompt["session_id"],
                "seq": prompt.get("request_seq") or 0,
                "type": "user_input.request",
                "payload": payload,
            }, ensure_ascii=False)
            yield f"data: {data}\n\n"
    except Exception:
        log.debug("Failed to replay pending user input prompts", exc_info=True)


async def _event_generator(
    request: Request,
    token: str | None = None,
) -> AsyncGenerator[str, None]:
    """Drain the event bus queue and yield SSE-formatted bytes."""
    bus = request.app.state.event_bus
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=256)
    bus.subscribe(queue)

    # Replay any pending path approvals so frontend can restore ApprovalCard
    async for event_str in _replay_pending_approvals():
        yield event_str
    async for event_str in _replay_pending_user_inputs():
        yield event_str

    try:
        while True:
            if await request.is_disconnected():
                break

            try:
                event = await asyncio.wait_for(queue.get(), timeout=KEEPALIVE_INTERVAL)
                data = json.dumps(
                    {
                        "session_id": event["session_id"],
                        "seq": event["seq"],
                        "type": event["type"],
                        "payload": event["payload"],
                    },
                    ensure_ascii=False,
                )
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                # Send keepalive comment
                yield ": keepalive\n\n"
    finally:
        bus.unsubscribe(queue)


@router.get("/events/stream")
async def event_stream(
    request: Request,
    token: str | None = Query(default=None),
):
    """SSE event stream (multiplexed across all sessions)."""
    return StreamingResponse(
        _event_generator(request, token),
        media_type="text/event-stream",
        headers={
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
