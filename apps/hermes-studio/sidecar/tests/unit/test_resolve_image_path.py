"""Unit tests for _resolve_image_path (clipboard-temp bypass + cwd scoping)."""
from __future__ import annotations

import tempfile
from pathlib import Path

import pytest

from daemon.services.session_service import _resolve_image_path


def _make_workspace(tmp_path: Path) -> Path:
    ws = tmp_path / "workspace"
    ws.mkdir()
    return ws


def test_temp_path_is_allowed_outside_cwd(tmp_path: Path) -> None:
    """A clipboard-pasted image living in the system temp dir resolves even
    though it is outside the session cwd."""
    ws = _make_workspace(tmp_path)
    # Simulate a clipboard temp file
    img = Path(tempfile.gettempdir()) / "hermes-clip-test.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")

    resolved = _resolve_image_path(str(img), str(ws))
    assert resolved == img.resolve()


def test_workspace_relative_path_scoped_to_cwd(tmp_path: Path) -> None:
    """A relative image path resolves under the cwd."""
    ws = _make_workspace(tmp_path)
    (ws / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n")

    resolved = _resolve_image_path("pic.png", str(ws))
    assert resolved == (ws / "pic.png").resolve()


def test_absolute_path_outside_cwd_and_temp_is_rejected(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An absolute path that is neither under cwd nor under temp is rejected
    by the cwd gate (path is outside cwd).

    The temp bypass is scoped to the real system temp dir; to test rejection
    we point the temp dir at a directory that does NOT contain the file under
    test, so the bypass does not swallow it.
    """
    ws = _make_workspace(tmp_path)
    isolated_temp = tmp_path / "isolated-temp"
    isolated_temp.mkdir()
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(isolated_temp))

    outside = tmp_path / "outside.png"
    outside.write_bytes(b"\x89PNG\r\n\x1a\n")

    with pytest.raises(ValueError, match="outside cwd"):
        _resolve_image_path(str(outside), str(ws))


def test_sibling_prefix_does_not_bypass_cwd_gate(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A directory whose name merely starts with the temp root string must NOT
    be admitted (guards against a string-prefix comparison regression)."""
    ws = _make_workspace(tmp_path)
    # temp root:  <tmp>/evil   ; sibling: <tmp>/eviltarget/secret.png
    evil_temp = tmp_path / "evil"
    evil_temp.mkdir()
    sibling_root = tmp_path / "eviltarget"
    sibling_root.mkdir()
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(evil_temp))

    secret = sibling_root / "secret.png"
    secret.write_bytes(b"\x89PNG\r\n\x1a\n")

    with pytest.raises(ValueError, match="outside cwd"):
        _resolve_image_path(str(secret), str(ws))


def test_temp_path_must_be_a_real_subdir_not_sibling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An image directly under the configured temp dir IS allowed."""
    ws = _make_workspace(tmp_path)
    real_temp = tmp_path / "real-temp"
    real_temp.mkdir()
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(real_temp))

    img = real_temp / "clip.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    resolved = _resolve_image_path(str(img), str(ws))
    assert resolved == img.resolve()


def test_hermes_home_session_asset_is_allowed_outside_cwd(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A persisted session-asset image under HERMES_HOME/sessions/<id>/assets
    resolves even though it is outside the session cwd and outside temp."""
    ws = _make_workspace(tmp_path)
    # Point HERMES_HOME at an isolated dir (not under temp) and temp elsewhere.
    isolated_temp = tmp_path / "isolated-temp"
    isolated_temp.mkdir()
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(isolated_temp))
    hermes_home = tmp_path / "fake-home"
    assets = hermes_home / "sessions" / "desktop_123" / "assets"
    assets.mkdir(parents=True)
    monkeypatch.setenv("HERMES_HOME", str(hermes_home))

    img = assets / "hermes-clip-1.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    resolved = _resolve_image_path(str(img), str(ws))
    assert resolved == img.resolve()


def test_default_hermes_home_session_asset_allowed_without_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """When HERMES_HOME is unset, the default ~/.hermes is still trusted.

    Reproduces the real runtime: the dev daemon is spawned without
    HERMES_HOME set, yet the Rust layer persists images under ~/.hermes.
    """
    ws = _make_workspace(tmp_path)
    isolated_temp = tmp_path / "isolated-temp"
    isolated_temp.mkdir()
    monkeypatch.setattr(tempfile, "gettempdir", lambda: str(isolated_temp))
    monkeypatch.delenv("HERMES_HOME", raising=False)
    # Redirect Path.home() to an isolated dir so the default ~/.hermes is
    # under tmp_path and we don't touch the real home directory.
    fake_home = tmp_path / "fake-user-home"
    assets = fake_home / ".hermes" / "sessions" / "desktop_456" / "assets"
    assets.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", lambda: fake_home)

    img = assets / "hermes-clip-2.png"
    img.write_bytes(b"\x89PNG\r\n\x1a\n")
    resolved = _resolve_image_path(str(img), str(ws))
    assert resolved == img.resolve()

