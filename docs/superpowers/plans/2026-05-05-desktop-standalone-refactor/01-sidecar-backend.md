# 01 — Sidecar backend (Tasks 1–18)

> Implements spec sections `01-architecture.md §"Sidecar tree"`, `02-data-flow.md`, `03-error-handling.md`, `04-testing.md §"Sidecar unit/integration tests"`.
>
> Working directory for all commands in this section: `desktop/backend/`
> unless explicitly noted otherwise.

---

## Task 1: Skeleton package + pyproject

**Files:**
- Create: `desktop/backend/pyproject.toml`
- Create: `desktop/backend/desktop_backend/__init__.py`
- Create: `desktop/backend/tests/__init__.py`
- Create: `desktop/backend/tests/unit/__init__.py`
- Create: `desktop/backend/tests/integration/__init__.py`
- Create: `desktop/backend/.gitignore`

- [ ] **Step 1: Create the package skeleton**

```bash
mkdir -p desktop/backend/desktop_backend
mkdir -p desktop/backend/tests/unit
mkdir -p desktop/backend/tests/integration
mkdir -p desktop/backend/tests/fixtures/hermes_home/cron
mkdir -p desktop/backend/tests/fixtures/hermes_home/cache
touch desktop/backend/desktop_backend/__init__.py
touch desktop/backend/tests/__init__.py
touch desktop/backend/tests/unit/__init__.py
touch desktop/backend/tests/integration/__init__.py
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[project]
name = "desktop_backend"
version = "0.1.0"
description = "Hermes Desktop sidecar (FastAPI). Local 127.0.0.1 only."
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.110,<1.0",
    "uvicorn>=0.29,<1.0",
    "pydantic>=2.6,<3.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0",
    "pytest-asyncio>=0.23",
    "pytest-cov>=5.0",
    "httpx>=0.27",
    "pyinstaller>=6.5",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["desktop_backend*"]
exclude = ["tests*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
asyncio_mode = "auto"
addopts = "-ra"
```

- [ ] **Step 3: Write `.gitignore`**

```gitignore
.venv/
build/
dist/
*.egg-info/
__pycache__/
.pytest_cache/
.coverage
htmlcov/
```

- [ ] **Step 4: Create venv + install**

```bash
cd desktop/backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -e '.[dev]'
```

Expected: install completes, no errors.

- [ ] **Step 5: Smoke import test**

```bash
python -c "import desktop_backend; print('ok')"
```
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add desktop/backend/pyproject.toml desktop/backend/desktop_backend desktop/backend/tests desktop/backend/.gitignore
git commit -m "chore(desktop-backend): scaffold sidecar package"
```

---

## Task 2: `config.py` — runtime configuration

**Files:**
- Create: `desktop/backend/desktop_backend/config.py`
- Create: `desktop/backend/tests/unit/test_config.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_config.py
import os
from pathlib import Path
import pytest

from desktop_backend.config import Config, ConfigError, load_config


def test_load_config_uses_default_hermes_home(monkeypatch, tmp_path):
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    cfg = load_config(require_token=False)
    assert cfg.hermes_home == tmp_path / ".hermes"
    assert cfg.token_file == tmp_path / ".hermes" / "desktop" / "sidecar.token"
    assert cfg.bind_host == "127.0.0.1"


def test_load_config_respects_hermes_home_env(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "alt"))
    cfg = load_config(require_token=False)
    assert cfg.hermes_home == tmp_path / "alt"


def test_load_config_requires_token_when_asked(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    token_file = tmp_path / ".hermes" / "desktop" / "sidecar.token"
    token_file.write_text("abc123")
    os.chmod(token_file, 0o600)
    cfg = load_config(require_token=True)
    assert cfg.token == "abc123"


def test_load_config_token_missing_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    with pytest.raises(ConfigError):
        load_config(require_token=True)


def test_load_config_token_bad_perm_raises(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    (tmp_path / ".hermes" / "desktop").mkdir(parents=True)
    token_file = tmp_path / ".hermes" / "desktop" / "sidecar.token"
    token_file.write_text("abc123")
    os.chmod(token_file, 0o644)  # too permissive
    with pytest.raises(ConfigError):
        load_config(require_token=True)
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/test_config.py -v
```
Expected: ImportError on `desktop_backend.config`.

- [ ] **Step 3: Implement `config.py`**

```python
# desktop_backend/config.py
"""Sidecar runtime configuration. Loaded once at startup."""
from __future__ import annotations

import os
import stat
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


class ConfigError(RuntimeError):
    """Configuration could not be loaded."""


@dataclass(frozen=True)
class Config:
    hermes_home: Path
    token_file: Path
    bind_host: str = "127.0.0.1"
    token: Optional[str] = None


def _default_hermes_home() -> Path:
    env = os.environ.get("HERMES_HOME")
    if env:
        return Path(env).expanduser()
    return Path.home() / ".hermes"


def _read_token(token_file: Path) -> str:
    if not token_file.exists():
        raise ConfigError(f"Token file missing: {token_file}")
    st = token_file.stat()
    mode = stat.S_IMODE(st.st_mode)
    if mode & 0o077:
        raise ConfigError(
            f"Token file {token_file} must be 0600; got {oct(mode)}"
        )
    token = token_file.read_text(encoding="utf-8").strip()
    if not token:
        raise ConfigError(f"Token file {token_file} is empty")
    return token


def load_config(*, require_token: bool) -> Config:
    home = _default_hermes_home()
    token_file = home / "desktop" / "sidecar.token"
    token = _read_token(token_file) if require_token else None
    return Config(hermes_home=home, token_file=token_file, token=token)
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/test_config.py -v
```

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/config.py desktop/backend/tests/unit/test_config.py
git commit -m "feat(desktop-backend): add Config + load_config with 0600 token check"
```

---

## Task 3: `util/atomic_write.py`

**Files:**
- Create: `desktop/backend/desktop_backend/util/__init__.py`
- Create: `desktop/backend/desktop_backend/util/atomic_write.py`
- Create: `desktop/backend/tests/unit/test_atomic_write.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_atomic_write.py
import json
import os
from pathlib import Path

import pytest

from desktop_backend.util.atomic_write import atomic_write_json


def test_atomic_write_creates_target(tmp_path):
    target = tmp_path / "out.json"
    atomic_write_json(target, {"a": 1})
    assert json.loads(target.read_text()) == {"a": 1}


def test_atomic_write_overwrites_existing(tmp_path):
    target = tmp_path / "out.json"
    target.write_text('{"old": true}')
    atomic_write_json(target, {"new": True})
    assert json.loads(target.read_text()) == {"new": True}


def test_atomic_write_uses_same_dir_tmp(tmp_path, monkeypatch):
    target = tmp_path / "out.json"
    captured = {}
    real_replace = os.replace

    def spy_replace(src, dst):
        captured["src"] = src
        captured["dst"] = dst
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", spy_replace)
    atomic_write_json(target, {"a": 1})
    assert Path(captured["src"]).parent == tmp_path
    assert Path(captured["dst"]) == target


def test_atomic_write_failure_leaves_original(tmp_path, monkeypatch):
    target = tmp_path / "out.json"
    target.write_text('{"keep": true}')

    def boom(*a, **kw):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        atomic_write_json(target, {"new": True})
    assert json.loads(target.read_text()) == {"keep": True}
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/test_atomic_write.py -v
```

- [ ] **Step 3: Implement `atomic_write.py`**

```python
# desktop_backend/util/__init__.py
```

```python
# desktop_backend/util/atomic_write.py
"""Atomic JSON write: tmp file → fsync → os.replace → dir fsync."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any


def atomic_write_json(target: Path, payload: Any, *, mode: int = 0o600) -> None:
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=target.name + ".",
        suffix=".tmp",
        dir=str(target.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2, sort_keys=True)
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp_path, mode)
        os.replace(tmp_path, target)
        # fsync the directory so the rename is durable
        dir_fd = os.open(str(target.parent), os.O_DIRECTORY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    except Exception:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        raise
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/test_atomic_write.py -v
```

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/util desktop/backend/tests/unit/test_atomic_write.py
git commit -m "feat(desktop-backend): add atomic_write_json utility"
```

---

## Task 4: `util/filelock.py`

**Files:**
- Create: `desktop/backend/desktop_backend/util/filelock.py`
- Create: `desktop/backend/tests/unit/test_filelock.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_filelock.py
import os
import threading
import time
from pathlib import Path

import pytest

from desktop_backend.util.filelock import file_lock, LockedError


def test_lock_acquires_and_releases(tmp_path):
    target = tmp_path / "x.json"
    target.write_text("{}")
    with file_lock(target, exclusive=True):
        pass  # released cleanly


def test_exclusive_lock_blocks_second_writer(tmp_path):
    target = tmp_path / "x.json"
    target.write_text("{}")

    held = threading.Event()
    release = threading.Event()

    def hold():
        with file_lock(target, exclusive=True, retries=0, retry_delay=0.01):
            held.set()
            release.wait(timeout=2)

    t = threading.Thread(target=hold)
    t.start()
    held.wait(timeout=2)
    with pytest.raises(LockedError):
        with file_lock(target, exclusive=True, retries=1, retry_delay=0.05):
            pass
    release.set()
    t.join()


def test_shared_locks_coexist(tmp_path):
    target = tmp_path / "x.json"
    target.write_text("{}")
    with file_lock(target, exclusive=False):
        with file_lock(target, exclusive=False):
            pass
```

- [ ] **Step 2: Run, expect FAIL**

```bash
pytest tests/unit/test_filelock.py -v
```

- [ ] **Step 3: Implement `filelock.py`**

```python
# desktop_backend/util/filelock.py
"""POSIX advisory file lock with retry budget. Not safe on NFS."""
from __future__ import annotations

import contextlib
import errno
import fcntl
import os
import time
from pathlib import Path
from typing import Iterator


class LockedError(RuntimeError):
    """Could not acquire lock within retry budget."""


@contextlib.contextmanager
def file_lock(
    target: Path,
    *,
    exclusive: bool,
    retries: int = 4,
    retry_delay: float = 0.25,
) -> Iterator[None]:
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Lock against a sibling .lock file so we don't truncate the target.
    lock_path = target.with_suffix(target.suffix + ".lock")
    flag = fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH
    flag |= fcntl.LOCK_NB
    fd = os.open(str(lock_path), os.O_RDWR | os.O_CREAT, 0o600)
    try:
        attempt = 0
        while True:
            try:
                fcntl.flock(fd, flag)
                break
            except OSError as exc:
                if exc.errno not in (errno.EAGAIN, errno.EACCES):
                    raise
                if attempt >= retries:
                    raise LockedError(f"Lock busy: {lock_path}") from exc
                time.sleep(retry_delay)
                attempt += 1
        try:
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
    finally:
        os.close(fd)
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/unit/test_filelock.py -v
```

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/util/filelock.py desktop/backend/tests/unit/test_filelock.py
git commit -m "feat(desktop-backend): add file_lock context manager"
```

---

## Task 5: `readers/cron_reader.py` (snapshot copy of `cron/jobs.py`)

**Files:**
- Create: `desktop/backend/desktop_backend/readers/__init__.py`
- Create: `desktop/backend/desktop_backend/readers/cron_reader.py`
- Create: `desktop/backend/tests/fixtures/hermes_home/cron/jobs.json`
- Create: `desktop/backend/tests/unit/test_cron_reader.py`

- [ ] **Step 1: Create fixture**

```bash
mkdir -p desktop/backend/tests/fixtures/hermes_home/cron
```

```json
// tests/fixtures/hermes_home/cron/jobs.json
{
  "jobs": [
    {
      "id": "job_test_001",
      "schedule": "0 9 * * *",
      "prompt": "morning briefing",
      "enabled": true,
      "created_at": "2026-05-05T09:00:00Z"
    },
    {
      "id": "job_test_002",
      "schedule": "*/5 * * * *",
      "prompt": "poll",
      "enabled": false,
      "created_at": "2026-05-05T09:00:00Z"
    }
  ]
}
```

- [ ] **Step 2: Write the failing test**

```python
# tests/unit/test_cron_reader.py
import json
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock

import pytest

from desktop_backend.readers.cron_reader import (
    L1CorruptError,
    get_job,
    load_jobs,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


def test_load_jobs_parses_fixture():
    jobs = load_jobs(FIXTURES)
    assert len(jobs) == 2
    assert jobs[0]["id"] == "job_test_001"
    assert jobs[0]["schedule"] == "0 9 * * *"


def test_load_jobs_returns_empty_when_missing(tmp_path):
    assert load_jobs(tmp_path) == []


def test_load_jobs_raises_l1_corrupt_on_invalid_json(tmp_path):
    cron_dir = tmp_path / "cron"
    cron_dir.mkdir()
    (cron_dir / "jobs.json").write_text("not-json{{{")
    with pytest.raises(L1CorruptError) as exc:
        load_jobs(tmp_path)
    assert exc.value.path.endswith("jobs.json")


def test_get_job_returns_none_for_unknown():
    assert get_job(FIXTURES, "missing") is None


def test_get_job_returns_match():
    job = get_job(FIXTURES, "job_test_002")
    assert job is not None
    assert job["enabled"] is False


def test_load_jobs_never_opens_for_write(tmp_path, monkeypatch):
    cron_dir = tmp_path / "cron"
    cron_dir.mkdir()
    (cron_dir / "jobs.json").write_text('{"jobs": []}')
    real_open = open
    calls = []

    def spy(path, mode="r", *a, **kw):
        calls.append(mode)
        return real_open(path, mode, *a, **kw)

    monkeypatch.setattr("builtins.open", spy)
    load_jobs(tmp_path)
    for mode in calls:
        assert "w" not in mode and "a" not in mode and "+" not in mode
```

- [ ] **Step 3: Run, expect FAIL**

```bash
pytest tests/unit/test_cron_reader.py -v
```

- [ ] **Step 4: Implement `cron_reader.py`**

```python
# desktop_backend/readers/__init__.py
```

```python
# desktop_backend/readers/cron_reader.py
# SNAPSHOT:
#   source: cron/jobs.py
#   upstream_sha: 69e4387e527e45fcd715dab02e4c3857872e1641
#   copied_at: 2026-05-05
#   stripped:
#     - CLI entry points (argparse, click)
#     - logging configuration (use stdlib logging in sidecar)
#     - mutation helpers (add_job / update_job / delete_job)
#     - scheduler runtime (we only read the persisted file)
#   resync_when:
#     - upstream `jobs.json` schema adds new required fields
#     - upstream renames the cron directory or filename
"""Pure read-only parser for ~/.hermes/cron/jobs.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

CRON_FILE = "cron/jobs.json"


class L1CorruptError(RuntimeError):
    def __init__(self, path: str, detail: str):
        super().__init__(f"L1 corrupt: {path}: {detail}")
        self.path = path
        self.detail = detail


def _file(hermes_home: Path) -> Path:
    return Path(hermes_home) / CRON_FILE


def load_jobs(hermes_home: Path) -> list[dict[str, Any]]:
    path = _file(hermes_home)
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except json.JSONDecodeError as exc:
        raise L1CorruptError(str(path), str(exc)) from exc
    jobs = payload.get("jobs") if isinstance(payload, dict) else None
    if not isinstance(jobs, list):
        raise L1CorruptError(str(path), "expected 'jobs' to be a list")
    return jobs


def get_job(hermes_home: Path, job_id: str) -> Optional[dict[str, Any]]:
    for job in load_jobs(hermes_home):
        if job.get("id") == job_id:
            return job
    return None
```

- [ ] **Step 5: Run, expect PASS**

```bash
pytest tests/unit/test_cron_reader.py -v
```

- [ ] **Step 6: Commit**

```bash
git add desktop/backend/desktop_backend/readers desktop/backend/tests/unit/test_cron_reader.py desktop/backend/tests/fixtures
git commit -m "feat(desktop-backend): add cron_reader (snapshot copy of cron/jobs.py)"
```

---

## Task 6: `readers/model_catalog.py` (snapshot copy)

**Files:**
- Create: `desktop/backend/desktop_backend/readers/model_catalog.py`
- Create: `desktop/backend/tests/fixtures/hermes_home/cache/model_catalog.json`
- Create: `desktop/backend/tests/unit/test_model_catalog_reader.py`

- [ ] **Step 1: Create fixture**

```json
// tests/fixtures/hermes_home/cache/model_catalog.json
{
  "providers": [
    {
      "id": "provider_test_anthropic",
      "name": "Anthropic",
      "models": [
        {"id": "claude-sonnet-4", "context_window": 200000}
      ],
      "auth": "api_key"
    },
    {
      "id": "provider_test_openai",
      "name": "OpenAI",
      "models": [
        {"id": "gpt-5", "context_window": 128000}
      ],
      "auth": "api_key"
    }
  ],
  "fetched_at": "2026-05-05T09:00:00Z"
}
```

- [ ] **Step 2: Write the failing test**

```python
# tests/unit/test_model_catalog_reader.py
from pathlib import Path

import pytest

from desktop_backend.readers.model_catalog import (
    L1CorruptError,
    get_providers,
    load_catalog,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


def test_load_catalog_parses_fixture():
    catalog = load_catalog(FIXTURES)
    assert catalog["fetched_at"] == "2026-05-05T09:00:00Z"
    assert len(catalog["providers"]) == 2


def test_get_providers_returns_list():
    providers = get_providers(FIXTURES)
    assert {p["id"] for p in providers} == {
        "provider_test_anthropic",
        "provider_test_openai",
    }


def test_load_catalog_missing_returns_empty(tmp_path):
    assert load_catalog(tmp_path) == {"providers": [], "fetched_at": None}


def test_load_catalog_corrupt_raises(tmp_path):
    cache_dir = tmp_path / "cache"
    cache_dir.mkdir()
    (cache_dir / "model_catalog.json").write_text("garbage")
    with pytest.raises(L1CorruptError):
        load_catalog(tmp_path)
```

- [ ] **Step 3: Run, expect FAIL**

```bash
pytest tests/unit/test_model_catalog_reader.py -v
```

- [ ] **Step 4: Implement `model_catalog.py`**

```python
# desktop_backend/readers/model_catalog.py
# SNAPSHOT:
#   source: hermes_cli/model_catalog.py
#   upstream_sha: 69e4387e527e45fcd715dab02e4c3857872e1641
#   copied_at: 2026-05-05
#   stripped:
#     - HTTP fetch logic (we only read the cached JSON)
#     - CLI argument handling
#   resync_when:
#     - upstream model catalog schema gains new top-level keys
#     - upstream relocates the cache file
"""Pure read-only parser for ~/.hermes/cache/model_catalog.json."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .cron_reader import L1CorruptError  # re-use type

CATALOG_FILE = "cache/model_catalog.json"


def _file(hermes_home: Path) -> Path:
    return Path(hermes_home) / CATALOG_FILE


def load_catalog(hermes_home: Path) -> dict[str, Any]:
    path = _file(hermes_home)
    if not path.exists():
        return {"providers": [], "fetched_at": None}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            payload = json.load(fh)
    except json.JSONDecodeError as exc:
        raise L1CorruptError(str(path), str(exc)) from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("providers"), list):
        raise L1CorruptError(str(path), "expected {providers: [...]}")
    payload.setdefault("fetched_at", None)
    return payload


def get_providers(hermes_home: Path) -> list[dict[str, Any]]:
    return load_catalog(hermes_home)["providers"]
```

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add desktop/backend/desktop_backend/readers/model_catalog.py desktop/backend/tests/unit/test_model_catalog_reader.py desktop/backend/tests/fixtures/hermes_home/cache
git commit -m "feat(desktop-backend): add model_catalog reader (snapshot copy)"
```

---

## Task 7: `overlays/loader.py` — load + update + corrupt recovery

**Files:**
- Create: `desktop/backend/desktop_backend/overlays/__init__.py`
- Create: `desktop/backend/desktop_backend/overlays/loader.py`
- Create: `desktop/backend/tests/unit/test_overlay_loader.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_overlay_loader.py
import json
import re
from pathlib import Path

import pytest

from desktop_backend.overlays.loader import load, update


def overlay_dir(home: Path) -> Path:
    return home / "desktop" / "overlays"


def test_load_missing_returns_empty(tmp_path):
    assert load(tmp_path, "cron") == {}


def test_load_valid_returns_payload(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text('{"job_test_001": {"pinned": true}}')
    assert load(tmp_path, "cron") == {"job_test_001": {"pinned": True}}


def test_load_corrupt_renames_and_returns_empty(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text("not json")
    assert load(tmp_path, "cron") == {}
    backups = list(d.glob("cron.json.corrupt-*"))
    assert len(backups) == 1
    assert re.match(
        r"cron\.json\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z",
        backups[0].name,
    )


def test_update_creates_file(tmp_path):
    update(tmp_path, "cron", "job_test_001", {"pinned": True})
    payload = json.loads((overlay_dir(tmp_path) / "cron.json").read_text())
    assert payload["job_test_001"]["pinned"] is True


def test_update_merges_into_existing_entry(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text(
        '{"job_test_001": {"pinned": true, "color": "red"}}'
    )
    update(tmp_path, "cron", "job_test_001", {"pinned": False})
    payload = json.loads((d / "cron.json").read_text())
    assert payload["job_test_001"] == {"pinned": False, "color": "red"}


def test_update_preserves_other_entities(tmp_path):
    d = overlay_dir(tmp_path)
    d.mkdir(parents=True)
    (d / "cron.json").write_text(
        '{"job_test_001": {"pinned": true}, "job_test_002": {"pinned": false}}'
    )
    update(tmp_path, "cron", "job_test_001", {"pinned": False})
    payload = json.loads((d / "cron.json").read_text())
    assert payload["job_test_002"] == {"pinned": False}
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `loader.py`**

```python
# desktop_backend/overlays/__init__.py
```

```python
# desktop_backend/overlays/loader.py
"""Layer 2 overlay loader. Corruption is recovered, never propagated."""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..util.atomic_write import atomic_write_json
from ..util.filelock import file_lock

log = logging.getLogger(__name__)


def _domain_path(hermes_home: Path, domain: str) -> Path:
    return Path(hermes_home) / "desktop" / "overlays" / f"{domain}.json"


def _backup_name(path: Path) -> Path:
    iso = (
        datetime.now(timezone.utc)
        .strftime("%Y-%m-%dT%H-%M-%SZ")
    )
    return path.with_name(f"{path.name}.corrupt-{iso}")


def load(hermes_home: Path, domain: str) -> dict[str, dict[str, Any]]:
    path = _domain_path(hermes_home, domain)
    if not path.exists():
        return {}
    try:
        with file_lock(path, exclusive=False):
            with open(path, "r", encoding="utf-8") as fh:
                payload = json.load(fh)
    except json.JSONDecodeError as exc:
        backup = _backup_name(path)
        try:
            os.rename(path, backup)
        except OSError:
            log.warning("Overlay corrupt and unrenamable: %s", path)
        log.warning(
            "Overlay corrupt; backed up to %s: %s", backup, exc
        )
        return {}
    if not isinstance(payload, dict):
        return {}
    return payload


def update(
    hermes_home: Path,
    domain: str,
    entity_id: str,
    patch: dict[str, Any],
) -> dict[str, Any]:
    path = _domain_path(hermes_home, domain)
    with file_lock(path, exclusive=True):
        current: dict[str, dict[str, Any]] = {}
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as fh:
                    loaded = json.load(fh)
                if isinstance(loaded, dict):
                    current = loaded
            except json.JSONDecodeError:
                # Corrupt — recover by starting fresh; loader will back up next read.
                current = {}
        entry = dict(current.get(entity_id, {}))
        entry.update(patch)
        current[entity_id] = entry
        atomic_write_json(path, current)
        return entry
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/overlays desktop/backend/tests/unit/test_overlay_loader.py
git commit -m "feat(desktop-backend): add overlay loader with corrupt-recovery"
```

---

## Task 8: `store/{settings,state}.py`

**Files:**
- Create: `desktop/backend/desktop_backend/store/__init__.py`
- Create: `desktop/backend/desktop_backend/store/settings.py`
- Create: `desktop/backend/desktop_backend/store/state.py`
- Create: `desktop/backend/tests/unit/test_store.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_store.py
import json
from pathlib import Path

import pytest

from desktop_backend.store import settings as settings_store
from desktop_backend.store import state as state_store
from desktop_backend.store.settings import SchemaVersionMismatch, SCHEMA_VERSION


def test_settings_load_returns_defaults_when_missing(tmp_path):
    out = settings_store.load(tmp_path)
    assert out["schema_version"] == SCHEMA_VERSION
    assert "ui" in out


def test_settings_save_roundtrip(tmp_path):
    payload = {"schema_version": SCHEMA_VERSION, "ui": {"theme": "dark"}}
    settings_store.save(tmp_path, payload)
    assert settings_store.load(tmp_path)["ui"]["theme"] == "dark"


def test_settings_save_rejects_wrong_schema(tmp_path):
    with pytest.raises(SchemaVersionMismatch):
        settings_store.save(tmp_path, {"schema_version": 999, "ui": {}})


def test_state_load_defaults(tmp_path):
    out = state_store.load(tmp_path)
    assert out["schema_version"] == SCHEMA_VERSION
    assert "last_open_route" in out


def test_state_save_roundtrip(tmp_path):
    payload = {"schema_version": SCHEMA_VERSION, "last_open_route": "/cron"}
    state_store.save(tmp_path, payload)
    assert state_store.load(tmp_path)["last_open_route"] == "/cron"
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement store**

```python
# desktop_backend/store/__init__.py
```

```python
# desktop_backend/store/settings.py
"""Layer 3: settings.json. Schema-versioned. Atomic writes."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..util.atomic_write import atomic_write_json
from ..util.filelock import file_lock

SCHEMA_VERSION = 1

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "ui": {
        "theme": "system",
        "verbose_logging": False,
    },
}


class SchemaVersionMismatch(RuntimeError):
    pass


def _path(hermes_home: Path) -> Path:
    return Path(hermes_home) / "desktop" / "settings.json"


def load(hermes_home: Path) -> dict[str, Any]:
    path = _path(hermes_home)
    if not path.exists():
        return json.loads(json.dumps(_DEFAULTS))  # deep copy
    with file_lock(path, exclusive=False):
        with open(path, "r", encoding="utf-8") as fh:
            try:
                payload = json.load(fh)
            except json.JSONDecodeError:
                return json.loads(json.dumps(_DEFAULTS))
    if not isinstance(payload, dict):
        return json.loads(json.dumps(_DEFAULTS))
    payload.setdefault("schema_version", SCHEMA_VERSION)
    return payload


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SchemaVersionMismatch(
            f"expected schema_version={SCHEMA_VERSION}, got {payload.get('schema_version')!r}"
        )
    path = _path(hermes_home)
    with file_lock(path, exclusive=True):
        atomic_write_json(path, payload)
    return payload
```

```python
# desktop_backend/store/state.py
"""Layer 3: state.json. Same shape contract as settings."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from ..util.atomic_write import atomic_write_json
from ..util.filelock import file_lock
from .settings import SCHEMA_VERSION, SchemaVersionMismatch

_DEFAULTS: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "last_open_route": "/",
    "window": {"w": 1280, "h": 800},
}


def _path(hermes_home: Path) -> Path:
    return Path(hermes_home) / "desktop" / "state.json"


def load(hermes_home: Path) -> dict[str, Any]:
    path = _path(hermes_home)
    if not path.exists():
        return json.loads(json.dumps(_DEFAULTS))
    with file_lock(path, exclusive=False):
        with open(path, "r", encoding="utf-8") as fh:
            try:
                payload = json.load(fh)
            except json.JSONDecodeError:
                return json.loads(json.dumps(_DEFAULTS))
    if not isinstance(payload, dict):
        return json.loads(json.dumps(_DEFAULTS))
    payload.setdefault("schema_version", SCHEMA_VERSION)
    return payload


def save(hermes_home: Path, payload: dict[str, Any]) -> dict[str, Any]:
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise SchemaVersionMismatch(
            f"expected schema_version={SCHEMA_VERSION}, got {payload.get('schema_version')!r}"
        )
    path = _path(hermes_home)
    with file_lock(path, exclusive=True):
        atomic_write_json(path, payload)
    return payload
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/store desktop/backend/tests/unit/test_store.py
git commit -m "feat(desktop-backend): add settings + state store with schema versioning"
```

---

## Task 9: Pydantic schemas

**Files:**
- Create: `desktop/backend/desktop_backend/schemas/__init__.py`
- Create: `desktop/backend/desktop_backend/schemas/cron.py`
- Create: `desktop/backend/desktop_backend/schemas/model.py`
- Create: `desktop/backend/desktop_backend/schemas/settings.py`
- Create: `desktop/backend/desktop_backend/schemas/error.py`
- Create: `desktop/backend/tests/unit/test_schemas.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_schemas.py
from desktop_backend.schemas.cron import CronOverlay, MergedCronJob
from desktop_backend.schemas.error import ErrorEnvelope
from desktop_backend.schemas.model import MergedProvider, ProviderOverlay


def test_cron_overlay_defaults():
    o = CronOverlay()
    assert o.pinned is False
    assert o.color is None


def test_merged_cron_job_round_trip():
    j = MergedCronJob(
        id="job_test_001",
        schedule="0 9 * * *",
        prompt="x",
        enabled=True,
        created_at="2026-05-05T09:00:00Z",
        desktop=CronOverlay(pinned=True),
    )
    assert j.desktop.pinned is True


def test_error_envelope_minimal():
    e = ErrorEnvelope(code="L1_CORRUPT", domain="cron", trace_id="t1")
    payload = e.model_dump(exclude_none=True)
    assert payload == {"code": "L1_CORRUPT", "domain": "cron", "trace_id": "t1"}


def test_provider_overlay_defaults():
    assert ProviderOverlay().visible is True
    assert ProviderOverlay().display_order is None
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement schemas**

```python
# desktop_backend/schemas/__init__.py
```

```python
# desktop_backend/schemas/cron.py
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class CronOverlay(BaseModel):
    pinned: bool = False
    color: Optional[str] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None


class MergedCronJob(BaseModel):
    id: str
    schedule: str
    prompt: str
    enabled: bool
    created_at: str
    desktop: CronOverlay = Field(default_factory=CronOverlay)
```

```python
# desktop_backend/schemas/model.py
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ProviderOverlay(BaseModel):
    visible: bool = True
    display_order: Optional[int] = None
    note: Optional[str] = None
    updated_at: Optional[str] = None


class MergedProvider(BaseModel):
    id: str
    name: str
    auth: Optional[str] = None
    models: list[dict[str, Any]] = Field(default_factory=list)
    desktop: ProviderOverlay = Field(default_factory=ProviderOverlay)
```

```python
# desktop_backend/schemas/settings.py
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class Settings(BaseModel):
    schema_version: int
    ui: dict[str, Any] = Field(default_factory=dict)


class State(BaseModel):
    schema_version: int
    last_open_route: str = "/"
    window: dict[str, Any] = Field(default_factory=dict)
```

```python
# desktop_backend/schemas/error.py
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class ErrorEnvelope(BaseModel):
    code: str
    domain: Optional[str] = None
    path: Optional[str] = None
    detail: Optional[str] = None
    trace_id: str
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/schemas desktop/backend/tests/unit/test_schemas.py
git commit -m "feat(desktop-backend): add pydantic schemas for cron/model/settings/error"
```

---

## Task 10: `services/merger.py`

**Files:**
- Create: `desktop/backend/desktop_backend/services/__init__.py`
- Create: `desktop/backend/desktop_backend/services/merger.py`
- Create: `desktop/backend/tests/unit/test_merger.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_merger.py
from desktop_backend.services.merger import merge_cron_jobs, merge_providers


JOBS = [
    {
        "id": "job_test_001",
        "schedule": "0 9 * * *",
        "prompt": "p",
        "enabled": True,
        "created_at": "2026-05-05T09:00:00Z",
    },
    {
        "id": "job_test_002",
        "schedule": "*/5 * * * *",
        "prompt": "q",
        "enabled": False,
        "created_at": "2026-05-05T09:00:00Z",
    },
]


def test_merge_cron_jobs_default_overlay():
    out = merge_cron_jobs(JOBS, {})
    assert all(j.desktop.pinned is False for j in out)
    assert [j.id for j in out] == ["job_test_001", "job_test_002"]


def test_merge_cron_jobs_applies_overlay():
    overlay = {"job_test_001": {"pinned": True, "color": "red"}}
    out = merge_cron_jobs(JOBS, overlay)
    assert out[0].desktop.pinned is True
    assert out[0].desktop.color == "red"
    assert out[1].desktop.pinned is False


def test_merge_cron_jobs_drops_orphan_overlay():
    overlay = {"orphan_id": {"pinned": True}}
    out = merge_cron_jobs(JOBS, overlay)
    ids = {j.id for j in out}
    assert "orphan_id" not in ids


def test_merge_providers_default_visible():
    providers = [{"id": "p1", "name": "P1", "models": []}]
    out = merge_providers(providers, {})
    assert out[0].desktop.visible is True
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement merger**

```python
# desktop_backend/services/__init__.py
```

```python
# desktop_backend/services/merger.py
"""Merge L1 read-models with L2 overlays. Returns Pydantic models."""
from __future__ import annotations

from typing import Any

from ..schemas.cron import CronOverlay, MergedCronJob
from ..schemas.model import MergedProvider, ProviderOverlay


def merge_cron_jobs(
    jobs: list[dict[str, Any]],
    overlay: dict[str, dict[str, Any]],
) -> list[MergedCronJob]:
    merged: list[MergedCronJob] = []
    for job in jobs:
        entry = overlay.get(job.get("id", ""), {})
        merged.append(
            MergedCronJob(
                id=job["id"],
                schedule=job["schedule"],
                prompt=job["prompt"],
                enabled=bool(job.get("enabled", True)),
                created_at=job.get("created_at", ""),
                desktop=CronOverlay(**entry),
            )
        )
    return merged


def merge_providers(
    providers: list[dict[str, Any]],
    overlay: dict[str, dict[str, Any]],
) -> list[MergedProvider]:
    merged: list[MergedProvider] = []
    for prov in providers:
        entry = overlay.get(prov.get("id", ""), {})
        merged.append(
            MergedProvider(
                id=prov["id"],
                name=prov.get("name", prov["id"]),
                auth=prov.get("auth"),
                models=prov.get("models", []),
                desktop=ProviderOverlay(**entry),
            )
        )
    return merged
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/services desktop/backend/tests/unit/test_merger.py
git commit -m "feat(desktop-backend): add merger for L1+L2 cron/provider"
```

---

## Task 11: `app.py` + auth dep + health router + error envelope handler

**Files:**
- Create: `desktop/backend/desktop_backend/app.py`
- Create: `desktop/backend/desktop_backend/routers/__init__.py`
- Create: `desktop/backend/desktop_backend/routers/health.py`
- Create: `desktop/backend/tests/integration/conftest.py`
- Create: `desktop/backend/tests/integration/test_health.py`
- Create: `desktop/backend/tests/integration/test_auth.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/integration/conftest.py
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from desktop_backend.app import build_app
from desktop_backend.config import Config


FIXTURES = Path(__file__).parent.parent / "fixtures" / "hermes_home"


@pytest.fixture
def hermes_home(tmp_path: Path) -> Path:
    dest = tmp_path / ".hermes"
    shutil.copytree(FIXTURES, dest)
    (dest / "desktop").mkdir(parents=True, exist_ok=True)
    return dest


@pytest.fixture
def cfg(hermes_home: Path) -> Config:
    return Config(
        hermes_home=hermes_home,
        token_file=hermes_home / "desktop" / "sidecar.token",
        bind_host="127.0.0.1",
        token="test-token",
    )


@pytest.fixture
def client(cfg: Config) -> TestClient:
    return TestClient(build_app(cfg))


@pytest.fixture
def auth() -> dict[str, str]:
    return {"Authorization": "Bearer test-token"}
```

```python
# tests/integration/test_health.py
def test_health_no_auth_required(client):
    r = client.get("/desktop/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"
```

```python
# tests/integration/test_auth.py
def test_missing_token_rejected(client):
    r = client.get("/desktop/api/cron/jobs")
    assert r.status_code == 401
    assert r.json()["code"] == "AUTH_FAILED"


def test_wrong_token_rejected(client):
    r = client.get(
        "/desktop/api/cron/jobs",
        headers={"Authorization": "Bearer wrong"},
    )
    assert r.status_code == 401


def test_correct_token_accepted(client, auth):
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `app.py` + health router**

```python
# desktop_backend/routers/__init__.py
```

```python
# desktop_backend/routers/health.py
from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

```python
# desktop_backend/app.py
"""FastAPI app factory. All routes mounted under /desktop/api."""
from __future__ import annotations

import hmac
import logging
import uuid
from typing import Optional

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import Config
from .readers.cron_reader import L1CorruptError
from .schemas.error import ErrorEnvelope

log = logging.getLogger(__name__)

API_PREFIX = "/desktop/api"
PUBLIC_PATHS = {f"{API_PREFIX}/health"}


def build_app(cfg: Config) -> FastAPI:
    app = FastAPI(title="Hermes Desktop Sidecar", openapi_url=None)
    app.state.cfg = cfg

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["tauri://localhost", "http://localhost:1420"],
        allow_credentials=False,
        allow_methods=["GET", "PATCH", "PUT"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def attach_trace_id(request: Request, call_next):
        request.state.trace_id = uuid.uuid4().hex
        response = await call_next(request)
        response.headers["X-Trace-Id"] = request.state.trace_id
        return response

    def require_token(request: Request) -> None:
        if request.url.path in PUBLIC_PATHS:
            return
        header = request.headers.get("Authorization", "")
        if not header.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="AUTH_FAILED")
        provided = header[len("Bearer "):].strip()
        if cfg.token is None or not hmac.compare_digest(provided, cfg.token):
            raise HTTPException(status_code=401, detail="AUTH_FAILED")

    app.dependency_overrides = {}

    @app.exception_handler(HTTPException)
    async def http_exc_handler(request: Request, exc: HTTPException):
        code = exc.detail if isinstance(exc.detail, str) else "INTERNAL"
        env = ErrorEnvelope(
            code=code,
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=exc.status_code)

    @app.exception_handler(L1CorruptError)
    async def l1_corrupt_handler(request: Request, exc: L1CorruptError):
        env = ErrorEnvelope(
            code="L1_CORRUPT",
            domain=_domain_from_path(request.url.path),
            path=exc.path,
            detail=exc.detail,
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=503)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled", extra={"trace_id": getattr(request.state, "trace_id", "?")})
        env = ErrorEnvelope(
            code="INTERNAL",
            detail=str(exc),
            trace_id=getattr(request.state, "trace_id", "unknown"),
        )
        return JSONResponse(env.model_dump(exclude_none=True), status_code=500)

    # Register routers
    from .routers import health, cron, model, settings as settings_router, state as state_router, overlays

    app.include_router(health.router, prefix=API_PREFIX)
    deps = [Depends(require_token)]
    app.include_router(cron.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(model.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(settings_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(state_router.router, prefix=API_PREFIX, dependencies=deps)
    app.include_router(overlays.router, prefix=API_PREFIX, dependencies=deps)

    return app


def _domain_from_path(path: str) -> Optional[str]:
    parts = path.strip("/").split("/")
    # /desktop/api/<domain>/...
    if len(parts) >= 3 and parts[0] == "desktop" and parts[1] == "api":
        return parts[2]
    return None
```

> Note: Tasks 12–15 add the imported routers. To make Task 11 pass in isolation, write **stub** routers below before running the test, then flesh out in subsequent tasks.

```python
# desktop_backend/routers/cron.py    (stub for Task 11)
from fastapi import APIRouter
router = APIRouter()

@router.get("/cron/jobs")
def list_jobs():
    return {"items": [], "generated_at": None}
```

```python
# desktop_backend/routers/model.py    (stub)
from fastapi import APIRouter
router = APIRouter()
```

```python
# desktop_backend/routers/settings.py (stub)
from fastapi import APIRouter
router = APIRouter()
```

```python
# desktop_backend/routers/state.py    (stub)
from fastapi import APIRouter
router = APIRouter()
```

```python
# desktop_backend/routers/overlays.py (stub)
from fastapi import APIRouter
router = APIRouter()
```

- [ ] **Step 4: Run, expect PASS**

```bash
pytest tests/integration/test_health.py tests/integration/test_auth.py -v
```

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/app.py desktop/backend/desktop_backend/routers desktop/backend/tests/integration
git commit -m "feat(desktop-backend): app factory + auth + health + error envelope"
```

---

## Task 12: `routers/cron.py`

**Files:**
- Modify: `desktop/backend/desktop_backend/routers/cron.py`
- Create: `desktop/backend/tests/integration/test_cron_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/test_cron_endpoints.py
import json


def test_list_jobs_default_overlay(client, auth):
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert {j["id"] for j in body["items"]} == {"job_test_001", "job_test_002"}
    assert all(j["desktop"]["pinned"] is False for j in body["items"])


def test_list_jobs_applies_overlay(client, auth, hermes_home):
    overlay_dir = hermes_home / "desktop" / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "cron.json").write_text(
        json.dumps({"job_test_001": {"pinned": True}})
    )
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    items = {j["id"]: j for j in r.json()["items"]}
    assert items["job_test_001"]["desktop"]["pinned"] is True


def test_get_job_404(client, auth):
    r = client.get("/desktop/api/cron/jobs/nope", headers=auth)
    assert r.status_code == 404
    assert r.json()["code"] == "NOT_FOUND"


def test_get_job_200(client, auth):
    r = client.get("/desktop/api/cron/jobs/job_test_001", headers=auth)
    assert r.status_code == 200
    assert r.json()["id"] == "job_test_001"


def test_corrupt_l1_returns_503(client, auth, hermes_home):
    (hermes_home / "cron" / "jobs.json").write_text("not-json")
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 503
    body = r.json()
    assert body["code"] == "L1_CORRUPT"
    assert body["path"].endswith("jobs.json")


def test_corrupt_l2_does_not_block_l1(client, auth, hermes_home):
    overlay_dir = hermes_home / "desktop" / "overlays"
    overlay_dir.mkdir(parents=True, exist_ok=True)
    (overlay_dir / "cron.json").write_text("garbage")
    r = client.get("/desktop/api/cron/jobs", headers=auth)
    assert r.status_code == 200
    backups = list(overlay_dir.glob("cron.json.corrupt-*"))
    assert len(backups) == 1
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `routers/cron.py`**

```python
# desktop_backend/routers/cron.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request

from ..overlays import loader as overlays_loader
from ..readers import cron_reader
from ..services.merger import merge_cron_jobs

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/cron/jobs")
def list_jobs(request: Request):
    cfg = request.app.state.cfg
    jobs = cron_reader.load_jobs(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "cron")
    merged = merge_cron_jobs(jobs, overlay)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }


@router.get("/cron/jobs/{job_id}")
def get_job(job_id: str, request: Request):
    cfg = request.app.state.cfg
    job = cron_reader.get_job(cfg.hermes_home, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    overlay = overlays_loader.load(cfg.hermes_home, "cron")
    merged = merge_cron_jobs([job], overlay)[0]
    return merged.model_dump()
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/routers/cron.py desktop/backend/tests/integration/test_cron_endpoints.py
git commit -m "feat(desktop-backend): cron router (list + get) with L1/L2 handling"
```

---

## Task 13: `routers/model.py`

**Files:**
- Modify: `desktop/backend/desktop_backend/routers/model.py`
- Create: `desktop/backend/tests/integration/test_model_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/test_model_endpoints.py
def test_get_catalog(client, auth):
    r = client.get("/desktop/api/model/catalog", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["fetched_at"] == "2026-05-05T09:00:00Z"
    assert len(body["providers"]) == 2


def test_get_providers_default_visible(client, auth):
    r = client.get("/desktop/api/model/providers", headers=auth)
    assert r.status_code == 200
    items = r.json()["items"]
    assert all(p["desktop"]["visible"] is True for p in items)


def test_providers_overlay_applied(client, auth, hermes_home):
    import json as _json
    od = hermes_home / "desktop" / "overlays"
    od.mkdir(parents=True, exist_ok=True)
    (od / "model.json").write_text(
        _json.dumps({"provider_test_openai": {"visible": False}})
    )
    items = {p["id"]: p for p in client.get(
        "/desktop/api/model/providers", headers=auth
    ).json()["items"]}
    assert items["provider_test_openai"]["desktop"]["visible"] is False
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `routers/model.py`**

```python
# desktop_backend/routers/model.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Request

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..services.merger import merge_providers

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/model/catalog")
def get_catalog(request: Request):
    cfg = request.app.state.cfg
    catalog = model_catalog.load_catalog(cfg.hermes_home)
    return {
        "providers": catalog["providers"],
        "fetched_at": catalog.get("fetched_at"),
    }


@router.get("/model/providers")
def list_providers(request: Request):
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/routers/model.py desktop/backend/tests/integration/test_model_endpoints.py
git commit -m "feat(desktop-backend): model router (catalog + providers w/ overlay)"
```

---

## Task 14: `routers/settings.py` + `routers/state.py`

**Files:**
- Modify: `desktop/backend/desktop_backend/routers/settings.py`
- Modify: `desktop/backend/desktop_backend/routers/state.py`
- Create: `desktop/backend/tests/integration/test_settings_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/test_settings_endpoints.py
def test_get_settings_defaults(client, auth):
    r = client.get("/desktop/api/settings", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["schema_version"] == 1
    assert "ui" in body


def test_put_settings_round_trip(client, auth):
    payload = {"schema_version": 1, "ui": {"theme": "dark"}}
    r = client.put("/desktop/api/settings", json=payload, headers=auth)
    assert r.status_code == 200
    r2 = client.get("/desktop/api/settings", headers=auth)
    assert r2.json()["ui"]["theme"] == "dark"


def test_put_settings_schema_mismatch(client, auth):
    r = client.put(
        "/desktop/api/settings",
        json={"schema_version": 999, "ui": {}},
        headers=auth,
    )
    assert r.status_code == 409
    assert r.json()["code"] == "SCHEMA_VERSION"


def test_get_state_defaults(client, auth):
    r = client.get("/desktop/api/state", headers=auth)
    assert r.status_code == 200
    assert r.json()["schema_version"] == 1


def test_put_state_round_trip(client, auth):
    r = client.put(
        "/desktop/api/state",
        json={"schema_version": 1, "last_open_route": "/cron"},
        headers=auth,
    )
    assert r.status_code == 200
    r2 = client.get("/desktop/api/state", headers=auth)
    assert r2.json()["last_open_route"] == "/cron"
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement routers**

```python
# desktop_backend/routers/settings.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..store import settings as store
from ..store.settings import SchemaVersionMismatch

router = APIRouter()


@router.get("/settings")
def get_settings(request: Request):
    cfg = request.app.state.cfg
    return store.load(cfg.hermes_home)


@router.put("/settings")
async def put_settings(request: Request):
    cfg = request.app.state.cfg
    payload = await request.json()
    try:
        return store.save(cfg.hermes_home, payload)
    except SchemaVersionMismatch:
        raise HTTPException(status_code=409, detail="SCHEMA_VERSION")
```

```python
# desktop_backend/routers/state.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..store import state as store
from ..store.settings import SchemaVersionMismatch

router = APIRouter()


@router.get("/state")
def get_state(request: Request):
    cfg = request.app.state.cfg
    return store.load(cfg.hermes_home)


@router.put("/state")
async def put_state(request: Request):
    cfg = request.app.state.cfg
    payload = await request.json()
    try:
        return store.save(cfg.hermes_home, payload)
    except SchemaVersionMismatch:
        raise HTTPException(status_code=409, detail="SCHEMA_VERSION")
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/routers/settings.py desktop/backend/desktop_backend/routers/state.py desktop/backend/tests/integration/test_settings_endpoints.py
git commit -m "feat(desktop-backend): settings + state routers (GET/PUT)"
```

---

## Task 15: `routers/overlays.py`

**Files:**
- Modify: `desktop/backend/desktop_backend/routers/overlays.py`
- Create: `desktop/backend/tests/integration/test_overlay_endpoints.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/integration/test_overlay_endpoints.py
import json


def test_patch_overlay_creates_file(client, auth, hermes_home):
    r = client.patch(
        "/desktop/api/overlays/cron/job_test_001",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 200
    assert r.json()["pinned"] is True
    payload = json.loads(
        (hermes_home / "desktop" / "overlays" / "cron.json").read_text()
    )
    assert payload["job_test_001"]["pinned"] is True


def test_patch_overlay_for_unknown_l1_still_succeeds(client, auth):
    r = client.patch(
        "/desktop/api/overlays/cron/never_seen",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 200


def test_patch_overlay_unknown_domain_rejected(client, auth):
    r = client.patch(
        "/desktop/api/overlays/whatever/x",
        json={"pinned": True},
        headers=auth,
    )
    assert r.status_code == 404


def test_patch_overlay_invalid_body(client, auth):
    r = client.patch(
        "/desktop/api/overlays/cron/job_test_001",
        json="not-an-object",
        headers=auth,
    )
    assert r.status_code == 422
```

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `routers/overlays.py`**

```python
# desktop_backend/routers/overlays.py
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from ..overlays import loader

router = APIRouter()

ALLOWED_DOMAINS = {"cron", "model"}


@router.patch("/overlays/{domain}/{entity_id}")
async def patch_overlay(domain: str, entity_id: str, request: Request):
    if domain not in ALLOWED_DOMAINS:
        raise HTTPException(status_code=404, detail="NOT_FOUND")
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(status_code=422, detail="VALIDATION")
    cfg = request.app.state.cfg
    return loader.update(cfg.hermes_home, domain, entity_id, body)
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/routers/overlays.py desktop/backend/tests/integration/test_overlay_endpoints.py
git commit -m "feat(desktop-backend): overlays PATCH router"
```

---

## Task 16: `__main__.py` — uvicorn boot + `READY <port>`

**Files:**
- Create: `desktop/backend/desktop_backend/__main__.py`

- [ ] **Step 1: Implement `__main__.py`** (covered by Task 18 test)

```python
# desktop_backend/__main__.py
"""Entry point. Binds 127.0.0.1:0, prints `READY <port>` on stdout."""
from __future__ import annotations

import asyncio
import logging
import socket
import sys
import threading

import uvicorn

from .app import build_app
from .config import load_config


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _announce(server: uvicorn.Server, port: int) -> None:
    while not server.started:
        # spin briefly waiting for uvicorn startup
        pass
    sys.stdout.write(f"READY {port}\n")
    sys.stdout.flush()


def main() -> int:
    logging.basicConfig(level=logging.INFO, stream=sys.stderr)
    cfg = load_config(require_token=True)
    app = build_app(cfg)
    port = _free_port()
    config = uvicorn.Config(
        app=app,
        host=cfg.bind_host,  # always 127.0.0.1
        port=port,
        log_level="info",
        access_log=False,
    )
    server = uvicorn.Server(config)
    threading.Thread(target=_announce, args=(server, port), daemon=True).start()
    server.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 2: Commit**

```bash
git add desktop/backend/desktop_backend/__main__.py
git commit -m "feat(desktop-backend): __main__ with READY <port> handshake"
```

---

## Task 17: Layer 1 immutability test (CRITICAL)

**Files:**
- Create: `desktop/backend/tests/integration/test_layer1_immutability.py`

- [ ] **Step 1: Write the test**

```python
# tests/integration/test_layer1_immutability.py
import hashlib
from pathlib import Path


def _hash_tree(root: Path) -> dict[str, str]:
    h: dict[str, str] = {}
    for p in sorted(root.rglob("*")):
        if p.is_file():
            h[str(p.relative_to(root))] = hashlib.sha256(p.read_bytes()).hexdigest()
    return h


def test_l1_unmodified_after_full_battery(client, auth, hermes_home):
    l1 = {
        "cron": _hash_tree(hermes_home / "cron"),
        "cache": _hash_tree(hermes_home / "cache"),
    }
    for _ in range(50):
        client.get("/desktop/api/cron/jobs", headers=auth)
        client.get("/desktop/api/cron/jobs/job_test_001", headers=auth)
        client.get("/desktop/api/model/providers", headers=auth)
        client.get("/desktop/api/model/catalog", headers=auth)
        client.get("/desktop/api/settings", headers=auth)
        client.put(
            "/desktop/api/settings",
            json={"schema_version": 1, "ui": {"theme": "dark"}},
            headers=auth,
        )
        client.patch(
            "/desktop/api/overlays/cron/job_test_001",
            json={"pinned": True},
            headers=auth,
        )
    after = {
        "cron": _hash_tree(hermes_home / "cron"),
        "cache": _hash_tree(hermes_home / "cache"),
    }
    assert l1 == after
```

- [ ] **Step 2: Run, expect PASS**

```bash
pytest tests/integration/test_layer1_immutability.py -v
```

- [ ] **Step 3: Commit**

```bash
git add desktop/backend/tests/integration/test_layer1_immutability.py
git commit -m "test(desktop-backend): L1 byte-identity invariant under request battery"
```

---

## Task 18: Bind-address invariant + READY handshake test

**Files:**
- Create: `desktop/backend/tests/integration/test_bind_address.py`

- [ ] **Step 1: Write the test**

```python
# tests/integration/test_bind_address.py
import os
import socket
import subprocess
import sys
import time
from pathlib import Path

import httpx


def _setup_home(tmp_path: Path) -> Path:
    home = tmp_path / ".hermes"
    (home / "desktop").mkdir(parents=True)
    (home / "cron").mkdir()
    (home / "cache").mkdir()
    (home / "cron" / "jobs.json").write_text('{"jobs": []}')
    (home / "cache" / "model_catalog.json").write_text(
        '{"providers": [], "fetched_at": null}'
    )
    token_file = home / "desktop" / "sidecar.token"
    token_file.write_text("integration-token")
    os.chmod(token_file, 0o600)
    return home


def test_sidecar_binds_loopback_only(tmp_path):
    home = _setup_home(tmp_path)
    env = {**os.environ, "HERMES_HOME": str(home)}
    proc = subprocess.Popen(
        [sys.executable, "-m", "desktop_backend"],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        env=env, text=True,
    )
    try:
        deadline = time.time() + 5
        port = None
        while time.time() < deadline:
            line = proc.stdout.readline()
            if line.startswith("READY "):
                port = int(line.split()[1])
                break
        assert port is not None, "sidecar did not announce READY <port>"

        # Loopback works
        r = httpx.get(f"http://127.0.0.1:{port}/desktop/api/health", timeout=2)
        assert r.status_code == 200

        # External interface refuses connection
        host_ip = socket.gethostbyname(socket.gethostname())
        if host_ip != "127.0.0.1":
            with pytest.raises(httpx.ConnectError):  # noqa: F821
                httpx.get(f"http://{host_ip}:{port}/desktop/api/health", timeout=1)
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            proc.kill()
```

- [ ] **Step 2: Run, expect PASS**

```bash
pytest tests/integration/test_bind_address.py -v
```

- [ ] **Step 3: Commit**

```bash
git add desktop/backend/tests/integration/test_bind_address.py
git commit -m "test(desktop-backend): sidecar binds loopback only + READY handshake"
```

---

## Section checkpoint

After Task 18, run the full sidecar suite:

```bash
cd desktop/backend
pytest --cov=desktop_backend --cov-report=term-missing
```

Expected: all green; coverage ≥ 90% (target from `04-testing.md`).
