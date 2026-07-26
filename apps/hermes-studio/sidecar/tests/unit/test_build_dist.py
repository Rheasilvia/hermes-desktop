from __future__ import annotations

import os
import subprocess
import sys
import time

import psutil

from scripts.build_dist import _mark_owned_process_group, _terminate_process_tree


def test_terminate_process_tree_reaps_owned_descendant():
    child_program = "import time; time.sleep(60)"
    parent_program = (
        "import subprocess, sys, time; "
        "child = subprocess.Popen([sys.executable, '-c', sys.argv[1]]); "
        "print(child.pid, flush=True); "
        "time.sleep(60)"
    )
    process = subprocess.Popen(
        [sys.executable, "-c", parent_program, child_program],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        start_new_session=(os.name == "posix"),
    )
    _mark_owned_process_group(process)
    assert process.stdout is not None
    child_pid = int(process.stdout.readline().strip())

    try:
        assert psutil.pid_exists(child_pid)
        _terminate_process_tree(process, timeout=3)

        deadline = time.monotonic() + 3
        while psutil.pid_exists(child_pid) and time.monotonic() < deadline:
            time.sleep(0.05)

        assert process.poll() is not None
        assert not psutil.pid_exists(child_pid)
    finally:
        # Exact-PID fallback only; never sweep by executable name.
        for pid in (child_pid, process.pid):
            try:
                psutil.Process(pid).kill()
            except psutil.NoSuchProcess:
                pass
