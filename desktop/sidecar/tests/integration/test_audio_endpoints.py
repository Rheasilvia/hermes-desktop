"""Integration tests for desktop audio endpoints."""

import base64
import sys
import types


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
