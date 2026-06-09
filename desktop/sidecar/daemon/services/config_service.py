from __future__ import annotations

import copy
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

from hermes_constants import reset_hermes_home_override, set_hermes_home_override

_SCHEMA_OVERRIDES: dict[str, dict[str, Any]] = {
    "model": {
        "type": "string",
        "description": "Default model",
        "category": "general",
    },
    "model_context_length": {
        "type": "number",
        "description": "Context window override (0 = auto-detect from model metadata)",
        "category": "general",
    },
    "tts.provider": {
        "type": "select",
        "description": "Text-to-speech provider",
        "category": "tts",
        "options": [
            "edge",
            "elevenlabs",
            "openai",
            "xai",
            "minimax",
            "mistral",
            "gemini",
            "neutts",
            "kittentts",
            "piper",
        ],
    },
    "tts.edge.voice": {
        "type": "string",
        "description": "Edge voice",
        "category": "tts",
    },
    "tts.openai.model": {
        "type": "select",
        "description": "OpenAI TTS model",
        "category": "tts",
        "options": ["gpt-4o-mini-tts", "tts-1", "tts-1-hd"],
    },
    "tts.openai.voice": {
        "type": "select",
        "description": "OpenAI voice",
        "category": "tts",
        "options": ["alloy", "echo", "fable", "onyx", "nova", "shimmer"],
    },
    "tts.elevenlabs.voice_id": {
        "type": "string",
        "description": "ElevenLabs voice",
        "category": "tts",
    },
    "tts.elevenlabs.model_id": {
        "type": "select",
        "description": "ElevenLabs TTS model",
        "category": "tts",
        "options": ["eleven_multilingual_v2", "eleven_turbo_v2_5", "eleven_flash_v2_5"],
    },
    "tts.xai.voice_id": {
        "type": "string",
        "description": "xAI voice",
        "category": "tts",
    },
    "tts.xai.language": {
        "type": "string",
        "description": "xAI language",
        "category": "tts",
    },
    "tts.minimax.model": {
        "type": "string",
        "description": "MiniMax TTS model",
        "category": "tts",
    },
    "tts.minimax.voice_id": {
        "type": "string",
        "description": "MiniMax voice",
        "category": "tts",
    },
    "tts.mistral.model": {
        "type": "string",
        "description": "Mistral TTS model",
        "category": "tts",
    },
    "tts.mistral.voice_id": {
        "type": "string",
        "description": "Mistral voice",
        "category": "tts",
    },
    "tts.gemini.model": {
        "type": "string",
        "description": "Gemini TTS model",
        "category": "tts",
    },
    "tts.gemini.voice": {
        "type": "string",
        "description": "Gemini voice",
        "category": "tts",
    },
    "tts.neutts.model": {
        "type": "string",
        "description": "NeuTTS model",
        "category": "tts",
    },
    "tts.neutts.device": {
        "type": "select",
        "description": "NeuTTS device",
        "category": "tts",
        "options": ["cpu", "cuda", "mps"],
    },
    "tts.kittentts.model": {
        "type": "string",
        "description": "KittenTTS model",
        "category": "tts",
    },
    "tts.kittentts.voice": {
        "type": "string",
        "description": "KittenTTS voice",
        "category": "tts",
    },
    "tts.piper.voice": {
        "type": "string",
        "description": "Piper voice",
        "category": "tts",
    },
    "stt.enabled": {
        "type": "boolean",
        "description": "Speech to text",
        "category": "stt",
    },
    "stt.provider": {
        "type": "select",
        "description": "Speech-to-text provider",
        "category": "stt",
        "options": ["local", "groq", "openai", "mistral", "xai", "elevenlabs"],
    },
    "stt.local.model": {
        "type": "select",
        "description": "Local STT model",
        "category": "stt",
        "options": ["tiny", "base", "small", "medium", "large-v3"],
    },
    "stt.local.language": {
        "type": "string",
        "description": "Local STT language",
        "category": "stt",
    },
    "stt.openai.model": {
        "type": "select",
        "description": "OpenAI STT model",
        "category": "stt",
        "options": ["whisper-1", "gpt-4o-mini-transcribe", "gpt-4o-transcribe"],
    },
    "stt.groq.model": {
        "type": "string",
        "description": "Groq STT model",
        "category": "stt",
    },
    "stt.mistral.model": {
        "type": "select",
        "description": "Mistral STT model",
        "category": "stt",
        "options": ["voxtral-mini-latest", "voxtral-mini-2602"],
    },
    "stt.elevenlabs.model_id": {
        "type": "select",
        "description": "ElevenLabs STT model",
        "category": "stt",
        "options": ["scribe_v2", "scribe_v1"],
    },
    "stt.elevenlabs.language_code": {
        "type": "string",
        "description": "ElevenLabs language",
        "category": "stt",
    },
    "stt.elevenlabs.tag_audio_events": {
        "type": "boolean",
        "description": "Tag audio events",
        "category": "stt",
    },
    "stt.elevenlabs.diarize": {
        "type": "boolean",
        "description": "Diarize speakers",
        "category": "stt",
    },
    "voice.auto_tts": {
        "type": "boolean",
        "description": "Read responses aloud",
        "category": "voice",
    },
    "voice.record_key": {
        "type": "string",
        "description": "Voice shortcut",
        "category": "voice",
    },
    "voice.max_recording_seconds": {
        "type": "number",
        "description": "Max recording length",
        "category": "voice",
    },
}

_CATEGORY_MERGE: dict[str, str] = {
    "privacy": "security",
    "context": "agent",
    "skills": "agent",
    "cron": "agent",
    "network": "agent",
    "checkpoints": "agent",
    "approvals": "security",
    "human_delay": "display",
    "dashboard": "display",
    "code_execution": "agent",
    "prompt_caching": "agent",
    "goals": "agent",
    "updates": "general",
    "onboarding": "agent",
    "telegram": "discord",
}

_CATEGORY_ORDER = [
    "general",
    "agent",
    "terminal",
    "display",
    "delegation",
    "memory",
    "compression",
    "security",
    "browser",
    "voice",
    "tts",
    "stt",
    "logging",
    "discord",
    "auxiliary",
]


@contextmanager
def _hermes_home_scope(hermes_home: Path) -> Iterator[None]:
    token = set_hermes_home_override(hermes_home)
    try:
        yield
    finally:
        reset_hermes_home_override(token)


def _config_path(hermes_home: Path) -> Path:
    return hermes_home / "config.yaml"


def _mtime(hermes_home: Path) -> float:
    try:
        return _config_path(hermes_home).stat().st_mtime
    except FileNotFoundError:
        return 0.0


def _infer_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "object"
    return "string"


def _build_schema_from_config(config: dict[str, Any], prefix: str = "") -> dict[str, dict[str, Any]]:
    schema: dict[str, dict[str, Any]] = {}
    for key, value in config.items():
        full_key = f"{prefix}.{key}" if prefix else key
        if full_key == "_config_version":
            continue
        if prefix:
            category = prefix.split(".", 1)[0]
        elif isinstance(value, dict):
            category = key
        else:
            category = "general"
        if isinstance(value, dict):
            schema.update(_build_schema_from_config(value, full_key))
            continue
        entry: dict[str, Any] = {
            "type": _infer_type(value),
            "description": full_key.replace(".", " ").replace("_", " ").title(),
            "category": category,
        }
        if full_key in _SCHEMA_OVERRIDES:
            entry.update(_SCHEMA_OVERRIDES[full_key])
        entry["category"] = _CATEGORY_MERGE.get(str(entry["category"]), entry["category"])
        schema[full_key] = entry
    return schema


def _schema(defaults: dict[str, Any]) -> dict[str, Any]:
    fields = _build_schema_from_config(defaults)
    ordered: dict[str, dict[str, Any]] = {}
    for key, value in fields.items():
        ordered[key] = value
        if key == "model":
            ordered["model_context_length"] = dict(_SCHEMA_OVERRIDES["model_context_length"])
    for key, value in _SCHEMA_OVERRIDES.items():
        if key not in ordered:
            entry = dict(value)
            entry.setdefault("category", key.split(".", 1)[0] if "." in key else "general")
            ordered[key] = entry
    return {"fields": ordered, "category_order": _CATEGORY_ORDER}


def _normalize_config(config: dict[str, Any]) -> dict[str, Any]:
    result = dict(config)
    model_value = result.get("model")
    if isinstance(model_value, dict):
        context_length = model_value.get("context_length", 0)
        result["model"] = model_value.get("default", model_value.get("name", ""))
        result["model_context_length"] = context_length if isinstance(context_length, int) else 0
    else:
        result["model_context_length"] = 0
    return {k: v for k, v in result.items() if not str(k).startswith("_")}


def _get_dot(config: dict[str, Any], path: str) -> Any:
    current: Any = config
    for part in path.split("."):
        if not isinstance(current, dict) or part not in current:
            return None
        current = current[part]
    return copy.deepcopy(current)


def _set_dot(config: dict[str, Any], path: str, value: Any) -> None:
    parts = path.split(".")
    current: dict[str, Any] = config
    for part in parts[:-1]:
        child = current.get(part)
        if not isinstance(child, dict):
            child = {}
            current[part] = child
        current = child
    current[parts[-1]] = copy.deepcopy(value)


def _denormalize_config(config: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    result = dict(config)
    context_length = result.pop("model_context_length", None)
    model_value = result.get("model")
    if isinstance(model_value, str) and model_value:
        current_model = current.get("model")
        if isinstance(current_model, dict):
            next_model = copy.deepcopy(current_model)
            next_model["default"] = model_value
            if isinstance(context_length, int) and context_length > 0:
                next_model["context_length"] = context_length
            elif isinstance(context_length, (int, float)):
                next_model.pop("context_length", None)
            result["model"] = next_model
        elif isinstance(context_length, int) and context_length > 0:
            result["model"] = {"default": model_value, "context_length": context_length}
    return result


class ConfigService:
    def __init__(self, hermes_home: Path):
        self._hermes_home = hermes_home

    def get_config(self) -> dict[str, Any]:
        from hermes_cli.config import load_config

        with _hermes_home_scope(self._hermes_home):
            return {"config": _normalize_config(load_config()), "mtime": _mtime(self._hermes_home)}

    def get_defaults(self) -> dict[str, Any]:
        from hermes_cli.config import DEFAULT_CONFIG

        return copy.deepcopy(DEFAULT_CONFIG)

    def get_schema(self) -> dict[str, Any]:
        return _schema(self.get_defaults())

    def save_config(
        self,
        incoming: dict[str, Any],
        *,
        changed_paths: list[str] | None = None,
    ) -> dict[str, Any]:
        from hermes_cli.config import load_config, save_config

        with _hermes_home_scope(self._hermes_home):
            current = load_config()
            if changed_paths:
                next_config = copy.deepcopy(current)
                normalized_current = _normalize_config(current)
                normalized_incoming = _normalize_config(incoming)
                for path in changed_paths:
                    value = _get_dot(normalized_incoming, path)
                    if value is None and _get_dot(normalized_current, path) is None:
                        continue
                    _set_dot(next_config, path, value)
            else:
                next_config = _denormalize_config(incoming, current)
            save_config(next_config)
            return {"ok": True, "mtime": _mtime(self._hermes_home)}
