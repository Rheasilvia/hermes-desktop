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
