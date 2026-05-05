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
