"""Integration tests for desktop audio endpoints."""

import base64
import json
import os
import sys
import types
from pathlib import Path


def test_transcribe_surfaces_backend_error_detail(client, auth, monkeypatch):
    module = types.ModuleType("tools.transcription_tools")

    def fake_transcribe_audio(_path):
        return {
            "success": False,
            "transcript": "",
            "provider": "local",
            "error": "Local transcription failed: model not found",
        }

    module.transcribe_audio = fake_transcribe_audio
    monkeypatch.setitem(sys.modules, "tools.transcription_tools", module)

    audio = base64.b64encode(b"voice").decode("ascii")
    response = client.post(
        "/desktop/api/audio/transcribe",
        headers=auth,
        json={"data_url": f"data:audio/webm;base64,{audio}", "mime_type": "audio/webm"},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Local transcription failed: model not found"


def test_transcribe_uses_active_profile_without_mutating_process_env(
    client,
    auth,
    hermes_home,
    monkeypatch,
):
    profile_home = _create_and_switch_profile(client, auth, hermes_home)
    sentinel_home = str(hermes_home / "sentinel-env-home")
    monkeypatch.setenv("HERMES_HOME", sentinel_home)
    observed: dict[str, str] = {}
    module = types.ModuleType("tools.transcription_tools")

    def fake_transcribe_audio(_path):
        from hermes_constants import get_hermes_home

        observed["home"] = str(get_hermes_home())
        observed["env"] = os.environ.get("HERMES_HOME", "")
        return {"success": True, "transcript": "hello", "provider": "test"}

    module.transcribe_audio = fake_transcribe_audio
    monkeypatch.setitem(sys.modules, "tools.transcription_tools", module)

    audio = base64.b64encode(b"voice").decode("ascii")
    response = client.post(
        "/desktop/api/audio/transcribe",
        headers=auth,
        json={"data_url": f"data:audio/webm;base64,{audio}", "mime_type": "audio/webm"},
    )

    assert response.status_code == 200
    assert response.json()["transcript"] == "hello"
    assert observed == {"home": str(profile_home), "env": sentinel_home}
    assert os.environ.get("HERMES_HOME") == sentinel_home


def test_tts_uses_active_profile_without_mutating_process_env(
    client,
    auth,
    hermes_home,
    tmp_path,
    monkeypatch,
):
    profile_home = _create_and_switch_profile(client, auth, hermes_home)
    sentinel_home = str(hermes_home / "sentinel-env-home")
    monkeypatch.setenv("HERMES_HOME", sentinel_home)
    audio_file = tmp_path / "speech.mp3"
    observed: dict[str, str] = {}
    module = types.ModuleType("tools.tts_tool")

    def fake_text_to_speech_tool(_text):
        from hermes_constants import get_hermes_home

        observed["home"] = str(get_hermes_home())
        observed["env"] = os.environ.get("HERMES_HOME", "")
        audio_file.write_bytes(b"mp3")
        return json.dumps({
            "success": True,
            "file_path": str(audio_file),
            "provider": "test",
        })

    module.text_to_speech_tool = fake_text_to_speech_tool
    monkeypatch.setitem(sys.modules, "tools.tts_tool", module)

    response = client.post(
        "/desktop/api/audio/speak",
        headers=auth,
        json={"text": "hello"},
    )

    assert response.status_code == 200
    assert response.json()["provider"] == "test"
    assert observed == {"home": str(profile_home), "env": sentinel_home}
    assert os.environ.get("HERMES_HOME") == sentinel_home


def _create_and_switch_profile(client, auth, hermes_home: Path) -> Path:
    created = client.post(
        "/desktop/api/profiles",
        json={"name": "research", "cloneFrom": "default"},
        headers=auth,
    )
    assert created.status_code == 200
    switched = client.put(
        "/desktop/api/profiles/active",
        json={"profileId": "research"},
        headers=auth,
    )
    assert switched.status_code == 200
    return hermes_home / "profiles" / "research"
