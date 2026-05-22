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


async def _event_generator(
    request: Request,
    token: str | None = None,
) -> AsyncGenerator[str, None]:
    """Drain the event bus queue and yield SSE-formatted bytes."""
    bus = request.app.state.event_bus
    queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=256)
    bus.subscribe(queue)

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
                        "payload": event["payload"],
                    },
                    ensure_ascii=False,
                )
                yield f"event: {event['type']}\ndata: {data}\n\n"
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
