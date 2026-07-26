"""Integration tests for Hermes config endpoints."""

import time

import yaml


def test_config_defaults_and_schema_include_voice_fields(client, auth):
    defaults = client.get("/desktop/api/config/defaults", headers=auth)
    assert defaults.status_code == 200
    assert defaults.json()["stt"]["enabled"] is True
    assert defaults.json()["tts"]["provider"] == "edge"
    assert defaults.json()["voice"]["max_recording_seconds"] == 120
    assert "desktop_sandbox" not in defaults.json()

    schema = client.get("/desktop/api/config/schema", headers=auth)
    assert schema.status_code == 200
    fields = schema.json()["fields"]
    assert "tts.provider" in fields
    assert "tts.edge.voice" in fields
    assert "tts.xai.voice_id" in fields
    assert "tts.minimax.model" in fields
    assert "tts.mistral.voice_id" in fields
    assert "tts.gemini.voice" in fields
    assert "tts.kittentts.voice" in fields
    assert "tts.piper.voice" in fields
    assert "stt.groq.model" in fields
    assert "stt.openai.model" in fields
    assert "stt.elevenlabs.diarize" in fields
    assert "voice.auto_tts" in fields
    assert "voice.max_recording_seconds" in fields
    assert "voice.record_key" not in fields
    assert "stt.model" not in fields
    assert "desktop_sandbox" not in fields


def test_config_put_round_trips_nested_voice_config(client, auth):
    current = client.get("/desktop/api/config", headers=auth).json()
    assert "desktop_sandbox" not in current["config"]
    payload = {
        "config": {
            "stt": {"openai": {"model": "gpt-4o-transcribe"}},
            "tts": {"elevenlabs": {"voice_id": "voice_custom"}},
            "voice": {"auto_tts": True},
            "desktop_sandbox": {"mode": "read-only", "network_access": "enabled"},
        },
        "base_mtime": current["mtime"],
        "changed_paths": [
            "stt.openai.model",
            "tts.elevenlabs.voice_id",
            "voice.auto_tts",
            "desktop_sandbox.mode",
        ],
    }

    saved = client.put("/desktop/api/config", json=payload, headers=auth)
    assert saved.status_code == 200

    reread = client.get("/desktop/api/config", headers=auth).json()["config"]
    assert reread["stt"]["openai"]["model"] == "gpt-4o-transcribe"
    assert reread["tts"]["elevenlabs"]["voice_id"] == "voice_custom"
    assert reread["voice"]["auto_tts"] is True
    assert "model" not in reread["stt"]
    assert "desktop_sandbox" not in reread


def test_config_put_merges_changed_paths_without_losing_external_changes(client, auth, hermes_home):
    config_path = hermes_home / "config.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "model": {
                    "provider": "openrouter",
                    "default": "anthropic/claude-sonnet-4",
                    "base_url": "https://openrouter.ai/api/v1",
                    "context_length": 123456,
                },
                "stt": {"provider": "local", "local": {"model": "base"}},
                "tts": {"provider": "edge", "edge": {"voice": "en-US-AriaNeural"}},
                "voice": {"max_recording_seconds": 120},
                "custom_section": {"keep": "me"},
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    first = client.get("/desktop/api/config", headers=auth).json()
    base_mtime = first["mtime"]

    time.sleep(0.01)
    config_path.write_text(
        yaml.safe_dump(
            {
                "model": {
                    "provider": "openrouter",
                    "default": "anthropic/claude-sonnet-4",
                    "base_url": "https://changed.example",
                    "context_length": 123456,
                },
                "stt": {"provider": "groq", "local": {"model": "base"}},
                "tts": {"provider": "edge", "edge": {"voice": "en-US-AriaNeural"}},
                "voice": {"max_recording_seconds": 120},
                "custom_section": {"keep": "external"},
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )

    stale_payload = {
        "config": {
            **first["config"],
            "voice": {
                **first["config"]["voice"],
                "max_recording_seconds": 45,
            },
        },
        "base_mtime": base_mtime,
        "changed_paths": ["voice.max_recording_seconds"],
    }

    saved = client.put("/desktop/api/config", json=stale_payload, headers=auth)
    assert saved.status_code == 200

    raw = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    assert raw["voice"]["max_recording_seconds"] == 45
    assert raw["stt"]["provider"] == "groq"
    assert raw["model"]["base_url"] == "https://changed.example"
    assert raw["model"]["context_length"] == 123456
    assert raw["custom_section"]["keep"] == "external"
