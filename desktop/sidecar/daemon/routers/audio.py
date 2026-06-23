"""Audio endpoints — STT transcription, TTS synthesis, ElevenLabs voice list.

Mirrors hermes_cli/web_server.py audio routes, reusing the same
tools.transcription_tools and tools.tts_tool backends.
"""
from __future__ import annotations

import asyncio
import base64
import binascii
import logging
import os
import tempfile
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, Request

from ..schemas.audio import (
    AudioTranscriptionRequest,
    AudioTranscriptionResponse,
    ElevenLabsVoice,
    ElevenLabsVoicesResponse,
    TTSSpeakRequest,
    TTSSpeakResponse,
)
from ..services.dependencies import get_active_hermes_home

log = logging.getLogger(__name__)

router = APIRouter(tags=["audio"])

_MAX_TRANSCRIPTION_UPLOAD_BYTES = 25 * 1024 * 1024  # 25 MB

_MIME_TO_EXT: Dict[str, str] = {
    "audio/webm": ".webm",
    "video/webm": ".webm",
    "audio/mp4": ".mp4",
    "audio/mpeg": ".mp3",
    "audio/mp3": ".mp3",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/wave": ".wav",
    "audio/flac": ".flac",
}


def _audio_extension_for_mime(mime: str) -> str:
    base = mime.split(";", 1)[0].lower().strip()
    return _MIME_TO_EXT.get(base, ".webm")


def _elevenlabs_voice_label(voice: Dict[str, Any]) -> str:
    name = str(voice.get("name") or voice.get("voice_id") or "Voice").strip()
    category = str(voice.get("category") or "").strip()
    return f"{name} ({category})" if category else name


@contextmanager
def _hermes_home_env(hermes_home: Path):
    previous = os.environ.get("HERMES_HOME")
    os.environ["HERMES_HOME"] = str(hermes_home)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = previous


@router.post("/audio/transcribe", response_model=AudioTranscriptionResponse)
async def transcribe_audio(request: Request, payload: AudioTranscriptionRequest) -> AudioTranscriptionResponse:
    data_url = (payload.data_url or "").strip()
    if not data_url.startswith("data:") or "," not in data_url:
        raise HTTPException(status_code=400, detail="Invalid audio payload")

    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise HTTPException(status_code=400, detail="Audio payload must be base64 encoded")

    mime_type = (
        payload.mime_type or header[5:].split(";", 1)[0] or "audio/webm"
    ).strip()
    normalized_mime = mime_type.split(";", 1)[0].lower()
    if not (normalized_mime.startswith("audio/") or normalized_mime == "video/webm"):
        raise HTTPException(status_code=400, detail="Payload must be an audio recording")

    try:
        audio_bytes = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(status_code=400, detail="Audio payload is not valid base64")

    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio recording is empty")
    if len(audio_bytes) > _MAX_TRANSCRIPTION_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Audio recording is too large")

    temp_path = ""
    try:
        suffix = _audio_extension_for_mime(mime_type)
        with tempfile.NamedTemporaryFile(
            prefix="hermes-desktop-voice-",
            suffix=suffix,
            delete=False,
        ) as tmp:
            tmp.write(audio_bytes)
            temp_path = tmp.name

        from tools.transcription_tools import transcribe_audio as _transcribe  # type: ignore[import]

        loop = asyncio.get_running_loop()
        hermes_home = get_active_hermes_home(request)

        def _run_transcribe() -> dict:
            with _hermes_home_env(hermes_home):
                return _transcribe(temp_path)

        result = await loop.run_in_executor(None, _run_transcribe)
    except HTTPException:
        raise
    except Exception as exc:
        log.exception("Desktop voice transcription failed")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Transcription failed",
        )

    return AudioTranscriptionResponse(
        ok=True,
        transcript=str(result.get("transcript") or "").strip(),
        provider=result.get("provider"),
    )


@router.post("/audio/speak", response_model=TTSSpeakResponse)
async def speak_text(request: Request, payload: TTSSpeakRequest) -> TTSSpeakResponse:
    text = (payload.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is required")

    try:
        from tools.tts_tool import text_to_speech_tool  # type: ignore[import]

        import json as _json

        loop = asyncio.get_running_loop()
        hermes_home = get_active_hermes_home(request)

        def _run_tts() -> str:
            with _hermes_home_env(hermes_home):
                return text_to_speech_tool(text)

        result_raw = await loop.run_in_executor(None, _run_tts)
    except Exception as exc:
        log.exception("Desktop voice TTS failed")
        raise HTTPException(status_code=500, detail=f"Speech synthesis failed: {exc}") from exc

    try:
        import json as _json
        result = _json.loads(result_raw) if isinstance(result_raw, str) else result_raw
    except Exception:
        raise HTTPException(status_code=500, detail="Invalid TTS response")

    if not result.get("success"):
        raise HTTPException(
            status_code=400,
            detail=result.get("error") or "Speech synthesis failed",
        )

    file_path = result.get("file_path")
    if not file_path or not os.path.isfile(file_path):
        raise HTTPException(status_code=500, detail="Audio file missing")

    ext = os.path.splitext(file_path)[1].lower()
    mime_type = {
        ".mp3": "audio/mpeg",
        ".ogg": "audio/ogg",
        ".opus": "audio/ogg",
        ".wav": "audio/wav",
        ".flac": "audio/flac",
    }.get(ext, "audio/mpeg")

    try:
        with open(file_path, "rb") as fh:
            audio_bytes = fh.read()
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Could not read audio: {exc}") from exc
    finally:
        try:
            os.unlink(file_path)
        except OSError:
            pass

    encoded = base64.b64encode(audio_bytes).decode("ascii")
    return TTSSpeakResponse(
        ok=True,
        data_url=f"data:{mime_type};base64,{encoded}",
        mime_type=mime_type,
        provider=result.get("provider"),
    )


@router.get("/audio/elevenlabs/voices", response_model=ElevenLabsVoicesResponse)
async def get_elevenlabs_voices(request: Request) -> ElevenLabsVoicesResponse:
    """Return ElevenLabs voices when an API key is configured."""
    hermes_home = get_active_hermes_home(request)

    try:
        from hermes_cli.config import load_env  # type: ignore[import]
        with _hermes_home_env(hermes_home):
            env = load_env()
    except Exception:
        env = {}

    api_key = (
        env.get("ELEVENLABS_API_KEY") or os.environ.get("ELEVENLABS_API_KEY") or ""
    ).strip()

    if not api_key:
        return ElevenLabsVoicesResponse(available=False, voices=[])

    req = urllib.request.Request(
        "https://api.elevenlabs.io/v1/voices",
        headers={"Accept": "application/json", "xi-api-key": api_key},
    )

    try:
        import json as _json

        loop = asyncio.get_running_loop()

        def _fetch() -> Dict[str, Any]:
            with urllib.request.urlopen(req, timeout=10) as response:
                return _json.loads(response.read().decode("utf-8"))

        payload = await loop.run_in_executor(None, _fetch)
    except Exception as exc:
        log.warning("ElevenLabs voice list failed: %s", exc)
        raise HTTPException(status_code=502, detail="Could not load ElevenLabs voices") from exc

    voices: list[ElevenLabsVoice] = []
    for voice in payload.get("voices") or []:
        if not isinstance(voice, dict):
            continue
        voice_id = str(voice.get("voice_id") or "").strip()
        if not voice_id:
            continue
        voices.append(
            ElevenLabsVoice(
                voice_id=voice_id,
                name=str(voice.get("name") or voice_id),
                label=_elevenlabs_voice_label(voice),
            )
        )

    voices.sort(key=lambda v: v.label.lower())
    return ElevenLabsVoicesResponse(available=True, voices=voices)
