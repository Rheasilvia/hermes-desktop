"""Shared helpers for user-attached image turns.

Desktop surfaces attach image paths to a session, then snapshot those paths at
turn start. This module keeps the native-image vs text-fallback routing logic in
one place so Electron/TUI and Tauri desktop stay aligned.
"""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import Any

from agent.image_routing import build_native_content_parts, decide_image_input_mode

logger = logging.getLogger(__name__)


IMAGE_EXTENSIONS = frozenset({
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".bmp",
    ".tiff",
    ".tif",
    ".heic",
})


def validate_local_image_path(path: str | Path) -> Path:
    """Return a resolved image path or raise ValueError."""
    raw = str(path or "").strip()
    if not raw:
        raise ValueError("path required")
    image_path = Path(raw).expanduser().resolve()
    if not image_path.exists() or not image_path.is_file():
        raise ValueError(f"image not found: {raw}")
    if image_path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"unsupported image: {image_path.name}")
    return image_path


def enrich_with_attached_images(user_text: str, image_paths: list[str]) -> str:
    """Pre-analyze attached images via vision and prepend descriptions."""
    from tools.vision_tools import vision_analyze_tool

    prompt = (
        "Describe everything visible in this image in thorough detail. "
        "Include any text, code, data, objects, people, layout, colors, "
        "and any other notable visual information."
    )

    parts: list[str] = []
    for path in image_paths:
        p = Path(path)
        if not p.exists():
            continue
        hint = f"[You can examine it with vision_analyze using image_url: {p}]"
        try:
            result = json.loads(
                asyncio.run(vision_analyze_tool(image_url=str(p), user_prompt=prompt))
            )
            desc = result.get("analysis", "") if result.get("success") else None
            parts.append(
                f"[The user attached an image:\n{desc}]\n{hint}"
                if desc
                else f"[The user attached an image but analysis failed.]\n{hint}"
            )
        except Exception:
            logger.debug("image text fallback failed for %s", p, exc_info=True)
            parts.append(f"[The user attached an image but analysis failed.]\n{hint}")

    text = user_text or ""
    prefix = "\n\n".join(parts)
    if prefix:
        return f"{prefix}\n\n{text}" if text else prefix
    return text or "What do you see in this image?"


def build_image_run_message(
    *,
    prompt: str,
    image_paths: list[str],
    agent: Any,
    provider: str,
    model: str,
    config: dict[str, Any] | None,
    log_prefix: str = "image_attachments",
) -> Any:
    """Return a text prompt or native multimodal content parts for a turn."""
    if not image_paths:
        return prompt

    try:
        mode = decide_image_input_mode(provider, model, config)
        if getattr(agent, "api_mode", "") == "codex_app_server":
            mode = "text"
    except Exception as exc:
        logger.warning("%s: image routing decision failed, defaulting to text: %s", log_prefix, exc)
        mode = "text"

    if mode == "native":
        try:
            parts, skipped = build_native_content_parts(prompt, image_paths)
            if skipped:
                logger.warning("%s: native image attachment skipped %d unreadable path(s)", log_prefix, len(skipped))
            if any(part.get("type") == "image_url" for part in parts):
                return parts
        except Exception as exc:
            logger.warning("%s: native attach failed, falling back to text: %s", log_prefix, exc)

    return enrich_with_attached_images(prompt, image_paths)


__all__ = [
    "IMAGE_EXTENSIONS",
    "build_image_run_message",
    "enrich_with_attached_images",
    "validate_local_image_path",
]
