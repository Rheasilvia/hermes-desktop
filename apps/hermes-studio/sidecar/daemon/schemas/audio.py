from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class AudioTranscriptionRequest(BaseModel):
    data_url: str
    mime_type: Optional[str] = None


class AudioTranscriptionResponse(BaseModel):
    ok: bool
    transcript: str
    provider: Optional[str] = None


class TTSSpeakRequest(BaseModel):
    text: str


class TTSSpeakResponse(BaseModel):
    ok: bool
    data_url: str
    mime_type: str
    provider: Optional[str] = None


class ElevenLabsVoice(BaseModel):
    voice_id: str
    name: str
    label: str


class ElevenLabsVoicesResponse(BaseModel):
    available: bool
    voices: list[ElevenLabsVoice]
