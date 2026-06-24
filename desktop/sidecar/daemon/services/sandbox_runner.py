from __future__ import annotations
import logging
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

log = logging.getLogger(__name__)

# Keep an immutable reference to the real Popen. Desktop tool overrides install
# short-lived subprocess proxy objects; the runner itself must bypass those
# proxies when spawning sandbox-exec or it recurses back into the wrapper.
_RAW_POPEN = subprocess.Popen

# ---------------------------------------------------------------------------
# Embedded seatbelt policy content (from codex project)
# ---------------------------------------------------------------------------

_SEATBELT_BASE_POLICY = r"""(version 1)

; inspired by Chrome's sandbox policy:
; https://source.chromium.org/chromium/chromium/src/+/main:sandbox/policy/mac/common.sb;l=273-319;drc=7b3962fe2e5fc9e2ee58000dc8fbf3429d84d3bd
; https://source.chromium.org/chromium/chromium/src/+/main:sandbox/policy/mac/renderer.sb;l=64;drc=7b3962fe2e5fc9e2ee58000dc8fbf3429d84d3bd

; start with closed-by-default
(deny default)

; child processes inherit the policy of their parent
(allow process-exec)
(allow process-fork)
(allow signal (target same-sandbox))

; process-info
(allow process-info* (target same-sandbox))

(allow file-write-data
  (require-all
    (path "/dev/null")
    (vnode-type CHARACTER-DEVICE)))

; sysctls permitted.
(allow sysctl-read
  (sysctl-name "hw.activecpu")
  (sysctl-name "hw.busfrequency_compat")
  (sysctl-name "hw.byteorder")
  (sysctl-name "hw.cacheconfig")
  (sysctl-name "hw.cachelinesize_compat")
  (sysctl-name "hw.cpufamily")
  (sysctl-name "hw.cpufrequency_compat")
  (sysctl-name "hw.cputype")
  (sysctl-name "hw.l1dcachesize_compat")
  (sysctl-name "hw.l1icachesize_compat")
  (sysctl-name "hw.l2cachesize_compat")
  (sysctl-name "hw.l3cachesize_compat")
  (sysctl-name "hw.logicalcpu_max")
  (sysctl-name "hw.machine")
  (sysctl-name "hw.model")
  (sysctl-name "hw.memsize")
  (sysctl-name "hw.ncpu")
  (sysctl-name "hw.nperflevels")
  ; Chrome locks these CPU feature detection down a bit more tightly,
  ; but mostly for fingerprinting concerns which isn't an issue for codex.
  (sysctl-name-prefix "hw.optional.arm.")
  (sysctl-name-prefix "hw.optional.armv8_")
  (sysctl-name "hw.packages")
  (sysctl-name "hw.pagesize_compat")
  (sysctl-name "hw.pagesize")
  (sysctl-name "hw.physicalcpu")
  (sysctl-name "hw.physicalcpu_max")
  (sysctl-name "hw.logicalcpu")
  (sysctl-name "hw.cpufrequency")
  (sysctl-name "hw.tbfrequency_compat")
  (sysctl-name "hw.vectorunit")
  (sysctl-name "machdep.cpu.brand_string")
  (sysctl-name "kern.argmax")
  (sysctl-name "kern.hostname")
  (sysctl-name "kern.maxfilesperproc")
  (sysctl-name "kern.maxproc")
  (sysctl-name "kern.osproductversion")
  (sysctl-name "kern.osrelease")
  (sysctl-name "kern.ostype")
  (sysctl-name "kern.osvariant_status")
  (sysctl-name "kern.osversion")
  (sysctl-name "kern.secure_kernel")
  (sysctl-name "kern.usrstack64")
  (sysctl-name "kern.version")
  (sysctl-name "sysctl.proc_cputype")
  (sysctl-name "vm.loadavg")
  (sysctl-name-prefix "hw.perflevel")
  (sysctl-name-prefix "kern.proc.pgrp.")
  (sysctl-name-prefix "kern.proc.pid.")
  (sysctl-name-prefix "net.routetable.")
)

; Allow Java to read some CPU info. This is misclassified as a "write" because
; userspace passes a memory buffer to the sysctl, but conceptually it is a read.
(allow sysctl-write
  (sysctl-name "kern.grade_cputype"))

; IOKit
(allow iokit-open
  (iokit-registry-entry-class "RootDomainUserClient")
)

; needed to look up user info, see https://crbug.com/792228
(allow mach-lookup
  (global-name "com.apple.system.opendirectoryd.libinfo")
)

; Needed for python multiprocessing on MacOS for the SemLock
(allow ipc-posix-sem)

; Needed for PyTorch/libomp on macOS to register OpenMP runtimes.
(allow ipc-posix-shm-read-data
  ipc-posix-shm-write-create
  ipc-posix-shm-write-unlink
  (ipc-posix-name-regex #"^/__KMP_REGISTERED_LIB_[0-9]+$"))

(allow mach-lookup
  (global-name "com.apple.PowerManagement.control")
)

; allow openpty()
(allow pseudo-tty)
(allow file-read* file-write* file-ioctl (literal "/dev/ptmx"))
(allow file-read* file-write*
  (require-all
    (regex #"^/dev/ttys[0-9]+")
    (extension "com.apple.sandbox.pty")))
; PTYs created before entering seatbelt may lack the extension; allow ioctl
; on those slave ttys so interactive shells detect a TTY and remain functional.
(allow file-ioctl (regex #"^/dev/ttys[0-9]+"))

; allow readonly user preferences
(allow ipc-posix-shm-read* (ipc-posix-name-prefix "apple.cfprefs."))
(allow mach-lookup
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.cfprefsd.agent")
  (local-name "com.apple.cfprefsd.agent"))
(allow user-preference-read)
"""

_SEATBELT_PLATFORM_DEFAULTS = r"""; macOS platform defaults included when a split filesystem policy requests `:minimal`.

; Read access to standard system paths
(allow file-read* file-test-existence
  (subpath "/Library/Apple")
  (subpath "/Library/Filesystems/NetFSPlugins")
  (subpath "/Library/Preferences/Logging")
  (subpath "/private/var/db/DarwinDirectory/local/recordStore.data")
  (subpath "/private/var/db/timezone")
  (subpath "/usr/lib")
  (subpath "/usr/share")
  (subpath "/Library/Preferences")
  (subpath "/var/db")
  (subpath "/private/var/db"))

; Map system frameworks + dylibs for loader.
(allow file-map-executable
  (subpath "/Library/Apple/System/Library/Frameworks")
  (subpath "/Library/Apple/System/Library/PrivateFrameworks")
  (subpath "/Library/Apple/usr/lib")
  (subpath "/System/Library/Extensions")
  (subpath "/System/Library/Frameworks")
  (subpath "/System/Library/PrivateFrameworks")
  (subpath "/System/Library/SubFrameworks")
  (subpath "/System/iOSSupport/System/Library/Frameworks")
  (subpath "/System/iOSSupport/System/Library/PrivateFrameworks")
  (subpath "/System/iOSSupport/System/Library/SubFrameworks")
  (subpath "/usr/lib"))

; System Framework and AppKit resources
(allow file-read* file-test-existence
  (subpath "/Library/Apple/System/Library/Frameworks")
  (subpath "/Library/Apple/System/Library/PrivateFrameworks")
  (subpath "/Library/Apple/usr/lib")
  (subpath "/System/Library/Frameworks")
  (subpath "/System/Library/PrivateFrameworks")
  (subpath "/System/Library/SubFrameworks")
  (subpath "/System/iOSSupport/System/Library/Frameworks")
  (subpath "/System/iOSSupport/System/Library/PrivateFrameworks")
  (subpath "/System/iOSSupport/System/Library/SubFrameworks")
  (subpath "/usr/lib"))

; Allow guarded vnodes.
(allow system-mac-syscall (mac-policy-name "vnguard"))

; Determine whether a container is expected.
(allow system-mac-syscall
  (require-all
    (mac-policy-name "Sandbox")
    (mac-syscall-number 67)))

; Allow resolution of standard system symlinks.
(allow file-read-metadata file-test-existence
  (literal "/etc")
  (literal "/tmp")
  (literal "/var")
  (literal "/private/etc/localtime"))

; Allow stat'ing of firmlink parent path components.
(allow file-read-metadata file-test-existence
  (path-ancestors "/System/Volumes/Data/private"))

; Allow processes to get their current working directory.
(allow file-read* file-test-existence
  (literal "/"))

; Allow FSIOC_CAS_BSDFLAGS as alternate chflags.
(allow system-fsctl (fsctl-command FSIOC_CAS_BSDFLAGS))

; Allow access to standard special files.
(allow file-read* file-test-existence
  (literal "/dev/autofs_nowait")
  (literal "/dev/random")
  (literal "/dev/urandom")
  (literal "/private/etc/master.passwd")
  (literal "/private/etc/passwd")
  (literal "/private/etc/protocols")
  (literal "/private/etc/services"))

; Allow null/zero read/write.
(allow file-read* file-test-existence file-write-data
  (literal "/dev/null")
  (literal "/dev/zero"))

; Allow read/write access to the file descriptors.
(allow file-read-data file-test-existence file-write-data
  (subpath "/dev/fd"))

; Provide access to debugger helpers.
(allow file-read* file-test-existence file-write-data file-ioctl
  (literal "/dev/dtracehelper"))

; Do not grant broad read/write access to world-writable temp directories.
; Desktop tools that need scratch space must stage it under the workspace.
; Apple's /usr/bin developer-tool shims (including /usr/bin/python3) create a
; narrow xcrun cache file under Darwin's per-user temp directory before exec.
; Allow only those cache files, not arbitrary temp paths.
(allow file-read* file-write* file-test-existence
  (regex #"^/private/var/folders/[^/]+/[^/]+/T/xcrun_db(-[A-Za-z0-9]+)?$")
  (regex #"^/var/folders/[^/]+/[^/]+/T/xcrun_db(-[A-Za-z0-9]+)?$"))

; Allow reading standard config directories.
(allow file-read* (subpath "/etc"))
(allow file-read* (subpath "/private/etc"))

(allow file-read* file-test-existence
  (literal "/System/Library/CoreServices")
  (literal "/System/Library/CoreServices/.SystemVersionPlatform.plist")
  (literal "/System/Library/CoreServices/SystemVersion.plist"))

; Some processes read /var metadata during startup.
(allow file-read-metadata (subpath "/var"))
(allow file-read-metadata (subpath "/private/var"))

; IOKit access for root domain services.
(allow iokit-open
  (iokit-registry-entry-class "RootDomainUserClient"))

; macOS Standard library queries opendirectoryd at startup
(allow mach-lookup (global-name "com.apple.system.opendirectoryd.libinfo"))

; Allow IPC to analytics, logging, trust, and other system agents.
(allow mach-lookup
  (global-name "com.apple.analyticsd")
  (global-name "com.apple.analyticsd.messagetracer")
  (global-name "com.apple.appsleep")
  (global-name "com.apple.bsd.dirhelper")
  (global-name "com.apple.cfprefsd.agent")
  (global-name "com.apple.cfprefsd.daemon")
  (global-name "com.apple.diagnosticd")
  (global-name "com.apple.dt.automationmode.reader")
  (global-name "com.apple.espd")
  (global-name "com.apple.logd")
  (global-name "com.apple.logd.events")
  (global-name "com.apple.runningboard")
  (global-name "com.apple.secinitd")
  (global-name "com.apple.system.DirectoryService.libinfo_v1")
  (global-name "com.apple.system.logger")
  (global-name "com.apple.system.notification_center")
  (global-name "com.apple.system.opendirectoryd.membership")
  (global-name "com.apple.trustd")
  (global-name "com.apple.trustd.agent")
  (global-name "com.apple.xpc.activity.unmanaged")
  (local-name "com.apple.cfprefsd.agent"))

; Allow IPC to the syslog socket for logging.
(allow network-outbound (literal "/private/var/run/syslog"))

; macOS Notifications
(allow ipc-posix-shm-read*
  (ipc-posix-name "apple.shm.notification_center"))

; Regulatory domain support.
(allow file-read*
  (literal "/private/var/db/eligibilityd/eligibility.plist"))

; Audio and power management services.
(allow mach-lookup (global-name "com.apple.audio.audiohald"))
(allow mach-lookup (global-name "com.apple.audio.AudioComponentRegistrar"))
(allow mach-lookup (global-name "com.apple.PowerManagement.control"))

; Allow reading the minimum system runtime so exec works.
(allow file-read-data (subpath "/bin"))
(allow file-read-metadata (subpath "/bin"))
(allow file-read-data (subpath "/sbin"))
(allow file-read-metadata (subpath "/sbin"))
(allow file-read-data (subpath "/usr/bin"))
(allow file-read-metadata (subpath "/usr/bin"))
(allow file-read-data (subpath "/usr/sbin"))
(allow file-read-metadata (subpath "/usr/sbin"))
(allow file-read-data (subpath "/usr/libexec"))
(allow file-read-metadata (subpath "/usr/libexec"))

(allow file-read* (subpath "/Library/Preferences"))
(allow file-read* (subpath "/opt/homebrew/lib"))
(allow file-read* (subpath "/usr/local/lib"))
(allow file-read* (subpath "/Applications"))

; Terminal basics and device handles.
(allow file-read* (regex "^/dev/fd/(0|1|2)$"))
(allow file-write* (regex "^/dev/fd/(1|2)$"))
(allow file-read* file-write* (literal "/dev/null"))
(allow file-read* file-write* (literal "/dev/tty"))
(allow file-read-metadata (literal "/dev"))
(allow file-read-metadata (regex "^/dev/.*$"))
(allow file-read-metadata (literal "/dev/stdin"))
(allow file-read-metadata (literal "/dev/stdout"))
(allow file-read-metadata (literal "/dev/stderr"))
(allow file-read-metadata (regex "^/dev/tty[^/]*$"))
(allow file-read-metadata (regex "^/dev/pty[^/]*$"))
(allow file-read* file-write* (regex "^/dev/ttys[0-9]+$"))
(allow file-read* file-write* (literal "/dev/ptmx"))
(allow file-ioctl (regex "^/dev/ttys[0-9]+$"))

; Allow metadata traversal for firmlink parents.
(allow file-read-metadata (literal "/System/Volumes") (vnode-type DIRECTORY))
(allow file-read-metadata (literal "/System/Volumes/Data") (vnode-type DIRECTORY))
(allow file-read-metadata (literal "/System/Volumes/Data/Users") (vnode-type DIRECTORY))

; App sandbox extensions
(allow file-read* (extension "com.apple.app-sandbox.read"))
(allow file-read* file-write* (extension "com.apple.app-sandbox.read-write"))
"""

_SEATBELT_EXECUTABLE = "/usr/bin/sandbox-exec"


# Maximum directory depth to descend when discovering git repositories under a
# workspace. Caps the cost of scanning very large monorepos so policy building
# stays cheap on the hot path. ``maxdepth`` counts levels below the workspace
# root, so 0 = only ``<ws>/.git``.
_DEFAULT_GIT_SCAN_MAXDEPTH = 8

class SandboxPolicyError(RuntimeError):
    pass


def _workspace_scratch_path(workspace_root: str | Path) -> Path:
    return Path(workspace_root) / ".hermes-sandbox" / "tmp"


def _canonical_workspace_root(workspace_root: str | Path) -> Path:
    try:
        return Path(workspace_root).resolve(strict=True)
    except OSError as exc:
        raise SandboxPolicyError(f"workspace root is unavailable: {exc}") from exc


def _reject_symlink(path: Path, *, label: str) -> None:
    if path.is_symlink():
        raise SandboxPolicyError(f"{label} must not be a symlink: {path}")


def _validate_scratch_root(root: str | Path, workspace_root: str | Path) -> Path:
    workspace = _canonical_workspace_root(workspace_root)
    root_path = Path(root)
    _reject_symlink(root_path.parent, label="desktop sandbox scratch parent")
    _reject_symlink(root_path, label="desktop sandbox scratch root")
    try:
        resolved = root_path.resolve()
    except OSError as exc:
        raise SandboxPolicyError(f"desktop sandbox scratch root is unavailable: {exc}") from exc
    try:
        resolved.relative_to(workspace)
    except ValueError as exc:
        raise SandboxPolicyError(
            f"desktop sandbox scratch root escapes workspace ({resolved} not under {workspace})"
        ) from exc
    return resolved


def ensure_workspace_sandbox_scratch(workspace_root: str | Path) -> Path:
    """Create and validate the workspace-local scratch root used by sandboxed children."""
    workspace = _canonical_workspace_root(workspace_root)
    scratch_parent = workspace / ".hermes-sandbox"
    scratch = scratch_parent / "tmp"

    _reject_symlink(scratch_parent, label="desktop sandbox scratch parent")
    if scratch_parent.exists() and not scratch_parent.is_dir():
        raise SandboxPolicyError(f"desktop sandbox scratch parent is not a directory: {scratch_parent}")
    scratch_parent.mkdir(mode=0o700, exist_ok=True)
    _reject_symlink(scratch_parent, label="desktop sandbox scratch parent")

    _reject_symlink(scratch, label="desktop sandbox scratch root")
    if scratch.exists() and not scratch.is_dir():
        raise SandboxPolicyError(f"desktop sandbox scratch root is not a directory: {scratch}")
    scratch.mkdir(mode=0o700, exist_ok=True)
    _reject_symlink(scratch, label="desktop sandbox scratch root")
    _validate_scratch_root(scratch, workspace)

    (scratch / "gitconfig").touch(exist_ok=True)
    (scratch / "xdg-config").mkdir(parents=True, exist_ok=True)
    (scratch / "xdg-cache").mkdir(parents=True, exist_ok=True)
    try:
        scratch.chmod(0o700)
    except OSError:
        pass
    return scratch


def with_workspace_scratch_env(env: dict[str, str], workspace_root: str | Path) -> dict[str, str]:
    scratch = ensure_workspace_sandbox_scratch(workspace_root)
    updated = dict(env)
    scratch_str = str(scratch)
    for key in ("TMPDIR", "TMP", "TEMP", "HERMES_EXECUTE_CODE_SOCKET_DIR"):
        updated[key] = scratch_str
    updated["HOME"] = scratch_str
    updated["GIT_CONFIG_GLOBAL"] = str(scratch / "gitconfig")
    updated["XDG_CONFIG_HOME"] = str(scratch / "xdg-config")
    updated["XDG_CACHE_HOME"] = str(scratch / "xdg-cache")
    return updated


def _parse_gitdir_pointer(dot_git_path: Path) -> Path | None:
    """Parse a ``.git`` file (submodule / worktree pointer).

    Returns the resolved gitdir it points at, or ``None`` if the file is not a
    well-formed ``gitdir: <path>`` pointer.
    """
    try:
        text = dot_git_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    # gitdir: /abs/path  or  gitdir: ../rel/path
    marker = "gitdir:"
    if not text.startswith(marker):
        return None
    raw_target = text[len(marker):].strip()
    if not raw_target:
        return None
    # Resolve relative pointers against the pointer's parent directory.
    target = Path(raw_target)
    if not target.is_absolute():
        target = dot_git_path.parent / target
    try:
        return target.resolve()
    except OSError:
        return None


def _discover_git_hook_dirs(
    workspace_root: str | Path,
    maxdepth: int = _DEFAULT_GIT_SCAN_MAXDEPTH,
) -> list[Path]:
    """Find all ``.git/hooks`` directories under ``workspace_root`` to protect.

    Covers the top-level ``<ws>/.git/hooks`` plus nested/bare repositories:
      - ``<ws>/x.git/hooks`` (bare repo)
      - ``<ws>/mono/repo-a/.git/hooks`` (nested working clone)
      - submodule ``.git`` *files* (``gitdir: <path>`` pointers) whose target
        resolves **inside** the workspace.

    Gitdir pointers that resolve *outside* the workspace are deliberately
    skipped: outside-workspace paths are already write-denied by the L1
    workspace boundary, so there is nothing to re-protect there.

    Returns canonical, de-duplicated paths.
    """
    ws_root = Path(workspace_root)
    try:
        ws_canonical = ws_root.resolve()
    except OSError:
        ws_canonical = ws_root

    found: set[Path] = set()

    def _try_add_hooks_dir(candidate_hooks: Path) -> None:
        try:
            resolved = candidate_hooks.resolve()
        except OSError:
            resolved = candidate_hooks
        # Only protect hooks dirs that live inside the workspace; ones outside
        # are already covered by the L1 boundary.
        try:
            resolved.relative_to(ws_canonical)
        except ValueError:
            return
        if resolved.is_dir():
            found.add(resolved)

    # 1. Top-level <ws>/.git/hooks
    _try_add_hooks_dir(ws_root / ".git" / "hooks")

    # 2. Walk the tree for nested / bare repos.
    # Depth tracking: os.walk yields (dirpath, dirnames, filenames). We prune
    # dirnames to control descent depth and to avoid descending into any ``.git``
    # directory's internals (we only care about the hooks subdir inside it).
    if maxdepth > 0:
        for dirpath, dirnames, filenames in os.walk(ws_root):
            rel = Path(dirpath).resolve()
            try:
                depth = len(rel.relative_to(ws_canonical).parts)
            except ValueError:
                # dirpath escaped the workspace via symlink; stop descending.
                dirnames[:] = []
                continue

            # Inspect entries at this level for git repositories.
            for name in list(dirnames):
                entry = Path(dirpath) / name
                is_git_dir_name = name == ".git" or name.endswith(".git")
                if not is_git_dir_name:
                    continue
                if entry.is_dir():
                    # Working clone (.git) or bare repo (foo.git).
                    _try_add_hooks_dir(entry / "hooks")
                    # Never descend into a git directory's internals beyond hooks.
                    dirnames.remove(name)
                # else: it's a .git *file* (pointer) — handled via filenames path.

            for fname in filenames:
                if fname != ".git":
                    continue
                pointer = Path(dirpath) / fname
                if not pointer.is_file():
                    continue
                target = _parse_gitdir_pointer(pointer)
                if target is not None:
                    _try_add_hooks_dir(target / "hooks")

            # Prune descent when we hit the depth cap.
            if depth >= maxdepth:
                dirnames[:] = []

    return sorted(found)


def _discover_git_config_paths(
    workspace_root: str | Path,
    maxdepth: int = _DEFAULT_GIT_SCAN_MAXDEPTH,
) -> list[Path]:
    """Find ``config`` files/paths for git directories under ``workspace_root``."""
    ws_root = Path(workspace_root)
    try:
        ws_canonical = ws_root.resolve()
    except OSError:
        ws_canonical = ws_root

    found: set[Path] = set()

    def _try_add_config(candidate_config: Path) -> None:
        try:
            resolved = candidate_config.resolve()
        except OSError:
            resolved = candidate_config
        try:
            resolved.relative_to(ws_canonical)
        except ValueError:
            return
        found.add(resolved)

    _try_add_config(ws_root / ".git" / "config")

    if maxdepth > 0:
        for dirpath, dirnames, filenames in os.walk(ws_root):
            rel = Path(dirpath).resolve()
            try:
                depth = len(rel.relative_to(ws_canonical).parts)
            except ValueError:
                dirnames[:] = []
                continue

            for name in list(dirnames):
                entry = Path(dirpath) / name
                is_git_dir_name = name == ".git" or name.endswith(".git")
                if not is_git_dir_name:
                    continue
                if entry.is_dir():
                    _try_add_config(entry / "config")
                    dirnames.remove(name)

            for fname in filenames:
                if fname != ".git":
                    continue
                pointer = Path(dirpath) / fname
                if not pointer.is_file():
                    continue
                target = _parse_gitdir_pointer(pointer)
                if target is not None:
                    _try_add_config(target / "config")

            if depth >= maxdepth:
                dirnames[:] = []

    return sorted(found)


def _build_executable_roots_policy(
    executable_roots: list[str] | None,
) -> tuple[str, list[tuple[str, str]]]:
    """Return ``(policy_text, params)`` granting read-only access to runtime roots.

    Paths are passed as ``-D`` parameters (referenced via ``(param …)``) so no
    path content is ever interpolated into the policy text.
    """
    if not executable_roots:
        return "", []

    rules: list[str] = ["; Explicit read-only executable runtimes"]
    params: list[tuple[str, str]] = []
    seen: set[str] = set()
    for root in executable_roots:
        if root in seen:
            continue
        seen.add(root)
        key = f"EXEC_ROOT_{len(params)}"
        params.append((key, root))
        rules.append(f'(allow file-read* file-test-existence (subpath (param "{key}")))')
        rules.append(f'(allow file-map-executable (subpath (param "{key}")))')
    return "\n".join(rules), params


def _resolved_executable_path(command: list[str], env: dict | None = None) -> Path | None:
    if not command:
        return None
    executable = command[0]
    if not isinstance(executable, str) or not executable:
        return None

    if "/" in executable:
        executable_path = Path(executable)
    else:
        found = shutil.which(executable, path=(env or {}).get("PATH"))
        if not found:
            return None
        executable_path = Path(found)

    try:
        return executable_path.resolve(strict=True)
    except OSError:
        return None


def _executable_root(resolved: Path) -> str:
    if resolved.parent.name == "bin":
        return str(resolved.parent.parent)
    return str(resolved.parent)


def _resolved_executable_root(command: list[str], env: dict | None = None) -> str | None:
    resolved = _resolved_executable_path(command, env)
    if resolved is None:
        return None
    return _executable_root(resolved)


def _build_workspace_access_policy(sandbox_mode: str) -> str:
    if sandbox_mode == "read-only":
        return """; Workspace access (read-only)
(allow file-read-metadata file-test-existence
  (path-ancestors (param "WORKSPACE_ROOT")))
(allow file-read* file-test-existence
  (subpath (param "WORKSPACE_ROOT")))"""
    return """; Workspace access
(allow file-read-metadata file-test-existence
  (path-ancestors (param "WORKSPACE_ROOT")))
(allow file-read* file-write* file-test-existence
  (subpath (param "WORKSPACE_ROOT")))"""


def _build_network_policy(network_access: str) -> str:
    if network_access == "enabled":
        return """; Explicit desktop sandbox network access
(allow network-outbound)
(allow network-inbound)"""
    return ""


def _build_future_git_metadata_deny_policy() -> str:
    """Deny Git execution metadata paths created after policy construction."""
    return r"""; Future-created Git execution metadata
(deny file-write*
  (require-all
    (subpath (param "WORKSPACE_ROOT"))
    (regex #"/(\.git|[^/]+\.git)/hooks(/|$)")))
(deny file-write*
  (require-all
    (subpath (param "WORKSPACE_ROOT"))
    (regex #"/(\.git|[^/]+\.git)/config$")))"""


def _build_future_metadata_deny_policy(
    protected_metadata_names: tuple[str, ...] | list[str],
) -> str:
    rules: list[str] = ["; Future-created desktop/user metadata paths"]
    for name in protected_metadata_names:
        if "/" in name or not name.startswith("."):
            continue
        escaped = re.escape(name)
        rules.append(
            f"""(deny file-write*
  (require-all
    (subpath (param "WORKSPACE_ROOT"))
    (regex #"/{escaped}(/|$)")))"""
        )
    return "\n".join(rules) if len(rules) > 1 else ""


def _build_scratch_policy(
    scratch_roots: list[str] | tuple[str, ...] | None,
    *,
    workspace_root: str | Path,
) -> tuple[str, list[tuple[str, str]]]:
    if not scratch_roots:
        return "", []

    rules: list[str] = ["; Desktop sandbox scratch for runner-owned temp files"]
    params: list[tuple[str, str]] = []
    seen: set[str] = set()
    for root in scratch_roots:
        resolved = str(_validate_scratch_root(root, workspace_root))
        if resolved in seen:
            continue
        seen.add(resolved)
        key = f"SCRATCH_ROOT_{len(params)}"
        params.append((key, resolved))
        rules.append(
            f'(allow file-read* file-write* file-test-existence (literal (param "{key}")))'
        )
        rules.append(
            f'(allow file-read* file-write* file-test-existence (subpath (param "{key}")))'
        )
    return "\n".join(rules), params


def _build_seatbelt_policy(
    workspace_root: str,
    hermes_home: str | None = None,
    executable_roots: list[str] | None = None,
    sandbox_mode: str = "workspace-write",
    network_access: str = "restricted",
    protected_metadata_names: tuple[str, ...] | list[str] | None = None,
    scratch_roots: list[str] | tuple[str, ...] | None = None,
) -> tuple[str, list[tuple[str, str]]]:
    """Build the seatbelt policy and its ``-D`` parameter list.

    Workspace-specific paths are passed to ``sandbox-exec`` as ``-D key=value``
    parameters (referenced via ``(param …)``) rather than interpolated into the
    policy text, so a workspace path containing policy metacharacters can neither
    break the policy nor inject rules (mirrors the codex sandbox).
    """
    if hermes_home is None:
        hermes_home = str(Path.home() / ".hermes")
    if sandbox_mode not in {"read-only", "workspace-write"}:
        sandbox_mode = "workspace-write"
    if network_access not in {"restricted", "enabled"}:
        network_access = "restricted"
    protected_metadata_names = tuple(protected_metadata_names or (".codex", ".agents", ".hermes"))

    # Canonicalize so the -D params match the REAL paths seatbelt evaluates
    # (e.g. macOS /var -> /private/var, /tmp -> /private/tmp); mirrors codex's
    # normalize_path_for_sandbox. Production snapshots are already canonical, so
    # this is idempotent there and only matters for non-canonical callers.
    try:
        workspace_root = str(Path(workspace_root).resolve())
    except OSError:
        pass
    try:
        hermes_home = str(Path(hermes_home).resolve())
    except OSError:
        pass

    if scratch_roots is None:
        scratch_roots = [str(_workspace_scratch_path(workspace_root))]

    exec_policy, exec_params = _build_executable_roots_policy(executable_roots)
    scratch_policy, scratch_params = _build_scratch_policy(
        scratch_roots,
        workspace_root=workspace_root,
    )

    # Discover every git hooks directory under the workspace (top-level,
    # nested working clones, bare repos, and in-workspace submodule pointers).
    # Each is write-denied separately below so an agent cannot plant a hook in
    # a nested/bare repo and have it run on the next git operation.
    hook_dirs = _discover_git_hook_dirs(workspace_root)

    hook_deny_rules: list[str] = []
    hook_params: list[tuple[str, str]] = []
    for index, hook_dir in enumerate(hook_dirs):
        key = f"WS_GIT_HOOK_{index}"
        hook_params.append((key, str(hook_dir)))
        hook_deny_rules.append(
            f'(deny file-write* (subpath (param "{key}")))'
        )
    hook_deny_block = "\n".join(hook_deny_rules)
    config_paths = _discover_git_config_paths(workspace_root)
    config_deny_rules: list[str] = []
    config_params: list[tuple[str, str]] = []
    for index, config_path in enumerate(config_paths):
        key = f"WS_GIT_CONFIG_{index}"
        config_params.append((key, str(config_path)))
        config_deny_rules.append(f'(deny file-write* (literal (param "{key}")))')
    config_deny_block = "\n".join(config_deny_rules)

    metadata_deny_rules: list[str] = []
    metadata_params: list[tuple[str, str]] = []
    for index, name in enumerate(protected_metadata_names):
        if "/" in name or not name.startswith("."):
            continue
        metadata_path = Path(workspace_root) / name
        paths = [metadata_path]
        try:
            resolved_metadata_path = metadata_path.resolve()
            if resolved_metadata_path != metadata_path:
                paths.append(resolved_metadata_path)
        except OSError:
            pass
        for metadata_path_variant in dict.fromkeys(str(path) for path in paths):
            key = f"WS_METADATA_{len(metadata_params)}"
            metadata_params.append((key, metadata_path_variant))
            metadata_deny_rules.append(f'(deny file-write* (literal (param "{key}")))')
            metadata_deny_rules.append(f'(deny file-write* (subpath (param "{key}")))')
    metadata_deny_block = "\n".join(metadata_deny_rules)
    future_git_metadata_deny_block = _build_future_git_metadata_deny_policy()
    future_metadata_deny_block = _build_future_metadata_deny_policy(protected_metadata_names)
    workspace_access_policy = _build_workspace_access_policy(sandbox_mode)
    network_policy = _build_network_policy(network_access)

    dynamic_policy = f"""
{workspace_access_policy}

{scratch_policy}

; .git/hooks and .git/config are an unsandboxed code-execution surface (a hook
; runs on the next git op; config sets core.hooksPath / aliases). Deny writes
; to every discovered hooks directory and config, while leaving reads
; working.
{hook_deny_block}
{config_deny_block}
{future_git_metadata_deny_block}

; Desktop/user metadata paths are not part of the editable project surface.
{metadata_deny_block}
{future_metadata_deny_block}

; Deny entire hermes home directory (config.yaml, .env, gateway_state, credentials).
; This takes precedence over the workspace allow above when hermes_home is inside workspace_root.
(deny file-read* file-write* (subpath (param "HERMES_HOME")))

{network_policy}
"""
    params: list[tuple[str, str]] = [
        ("WORKSPACE_ROOT", workspace_root),
        ("HERMES_HOME", hermes_home),
        *hook_params,
        *config_params,
        *metadata_params,
        *scratch_params,
        *exec_params,
    ]
    policy = "\n".join([
        _SEATBELT_BASE_POLICY,
        _SEATBELT_PLATFORM_DEFAULTS,
        exec_policy,
        dynamic_policy,
    ])
    return policy, params


class SandboxResult:
    def __init__(self, returncode: int, stdout: str, stderr: str) -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class MacOSSandboxRunner:
    """Runs a command inside macOS sandbox-exec (seatbelt)."""

    def is_available(self) -> bool:
        return sys.platform == "darwin" and Path(_SEATBELT_EXECUTABLE).exists()

    def run(
        self,
        command: list[str],
        cwd: str,
        env: dict[str, str] | None,
        timeout: int,
        workspace_root: str,
        hermes_home: str | None = None,
        sandbox_mode: str = "workspace-write",
        network_access: str = "restricted",
        protected_metadata_names: tuple[str, ...] | list[str] | None = None,
    ) -> SandboxResult:
        try:
            policy, params = _build_seatbelt_policy(
                workspace_root,
                hermes_home,
                sandbox_mode=sandbox_mode,
                network_access=network_access,
                protected_metadata_names=protected_metadata_names,
            )
        except SandboxPolicyError as exc:
            return SandboxResult(-1, "", f"sandbox policy error: {exc}")
        define_args = [f"-D{key}={value}" for key, value in params]
        argv = [_SEATBELT_EXECUTABLE, "-p", policy, *define_args, "--", *command]
        try:
            result = subprocess.run(
                argv,
                cwd=cwd,
                env=env,
                timeout=timeout,
                capture_output=True,
                text=True,
            )
            return SandboxResult(result.returncode, result.stdout, result.stderr)
        except subprocess.TimeoutExpired:
            return SandboxResult(-1, "", "sandbox execution timed out")
        except Exception as exc:
            return SandboxResult(-1, "", f"sandbox execution error: {exc}")


    def popen(
        self,
        command: list[str],
        *,
        snapshot,
        cwd: str | None = None,
        env: dict | None = None,
        stdin=None,
        stdout=None,
        stderr=None,
        text: bool = False,
        encoding: str | None = None,
        errors: str | None = None,
        preexec_fn=None,
        allow_command_executable: bool = False,
        **kwargs,
    ) -> subprocess.Popen:
        """Wrap a subprocess spawn inside the macOS seatbelt sandbox."""
        executable_roots = None
        sandbox_command = command
        if allow_command_executable:
            resolved = _resolved_executable_path(command, env)
            if resolved is not None:
                sandbox_command = [str(resolved), *command[1:]]
                executable_roots = [_executable_root(resolved)]
        if executable_roots is None:
            policy, params = _build_seatbelt_policy(
                str(snapshot.workspace_root),
                hermes_home=str(snapshot.hermes_home) if getattr(snapshot, "hermes_home", None) else None,
                sandbox_mode=getattr(snapshot, "sandbox_mode", "workspace-write"),
                network_access=getattr(snapshot, "network_access", "restricted"),
                protected_metadata_names=getattr(snapshot, "protected_metadata_names", None),
            )
        else:
            policy, params = _build_seatbelt_policy(
                str(snapshot.workspace_root),
                hermes_home=str(snapshot.hermes_home) if getattr(snapshot, "hermes_home", None) else None,
                executable_roots=executable_roots,
                sandbox_mode=getattr(snapshot, "sandbox_mode", "workspace-write"),
                network_access=getattr(snapshot, "network_access", "restricted"),
                protected_metadata_names=getattr(snapshot, "protected_metadata_names", None),
            )
        define_args = [f"-D{key}={value}" for key, value in params]
        sandboxed_cmd = [_SEATBELT_EXECUTABLE, "-p", policy, *define_args, "--", *sandbox_command]
        return _RAW_POPEN(
            sandboxed_cmd,
            cwd=cwd,
            env=env,
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            text=text,
            encoding=encoding,
            errors=errors,
            preexec_fn=preexec_fn,
            **kwargs,
        )


_RUNNER: MacOSSandboxRunner | None = None


def get_sandbox_runner() -> MacOSSandboxRunner | None:
    """Return the sandbox runner if available on this platform, else None."""
    global _RUNNER
    if _RUNNER is None:
        _RUNNER = MacOSSandboxRunner()
    if not _RUNNER.is_available():
        return None
    return _RUNNER
