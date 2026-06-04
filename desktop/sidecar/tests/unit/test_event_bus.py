"""Unit tests for daemon.services.event_bus."""
from __future__ import annotations

import asyncio

import pytest

from daemon.services.event_bus import EventBus


@pytest.mark.asyncio
async def test_subscribe_and_receive():
    bus = EventBus()
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=16)
    bus.subscribe(q)

    bus.publish("s1", 1, "user", {"text": "hello"})

    # Wait for the flush loop to drain the staging queue (50ms sleep + buffer)
    await asyncio.sleep(0.1)

    event = q.get_nowait()
    assert event["session_id"] == "s1"
    assert event["seq"] == 1
    assert event["type"] == "user"
    assert event["payload"] == {"text": "hello"}


@pytest.mark.asyncio
async def test_fan_out_to_two_subscribers():
    bus = EventBus()
    q1: asyncio.Queue[dict] = asyncio.Queue(maxsize=16)
    q2: asyncio.Queue[dict] = asyncio.Queue(maxsize=16)
    bus.subscribe(q1)
    bus.subscribe(q2)

    bus.publish("s1", 1, "tool.start", {"tool_id": "t1"})
    await asyncio.sleep(0.1)

    assert not q1.empty()
    assert not q2.empty()
    e1 = q1.get_nowait()
    e2 = q2.get_nowait()
    assert e1["payload"]["tool_id"] == "t1"
    assert e2["payload"]["tool_id"] == "t1"


@pytest.mark.asyncio
async def test_unsubscribe_stops_delivery():
    bus = EventBus()
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=16)
    bus.subscribe(q)

    bus.publish("s1", 1, "user", {"text": "x"})
    await asyncio.sleep(0.1)

    # Drain
    while not q.empty():
        q.get_nowait()

    bus.unsubscribe(q)
    bus.publish("s1", 2, "user", {"text": "y"})
    await asyncio.sleep(0.1)

    assert q.empty()


@pytest.mark.asyncio
async def test_publish_from_worker_thread():
    """Events from a non-asyncio thread are flushed correctly."""
    import threading

    bus = EventBus()
    q: asyncio.Queue[dict] = asyncio.Queue(maxsize=16)
    bus.subscribe(q)

    def _publish():
        bus.publish("s_thread", 42, "turn_error", {"error": "boom"})

    t = threading.Thread(target=_publish)
    t.start()
    t.join()

    # Flush loop runs every 50ms on the asyncio thread
    await asyncio.sleep(0.15)

    assert not q.empty()
    event = q.get_nowait()
    assert event["session_id"] == "s_thread"
    assert event["seq"] == 42
    assert event["type"] == "turn_error"
    assert event["payload"]["error"] == "boom"
