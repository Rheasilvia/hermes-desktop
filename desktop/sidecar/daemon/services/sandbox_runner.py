from __future__ import annotations
import logging
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


def _quote_seatbelt_path(path: str) -> str:
    return path.replace('"', '\\"')


def _build_executable_roots_policy(executable_roots: list[str] | None) -> str:
    if not executable_roots:
        return ""

    rules: list[str] = ["; Explicit read-only executable runtimes"]
    seen: set[str] = set()
    for root in executable_roots:
        root_escaped = _quote_seatbelt_path(root)
        if root_escaped in seen:
            continue
        seen.add(root_escaped)
        rules.append(f'(allow file-read* file-test-existence (subpath "{root_escaped}"))')
        rules.append(f'(allow file-map-executable (subpath "{root_escaped}"))')
    return "\n".join(rules)


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


def _build_seatbelt_policy(
    workspace_root: str,
    hermes_home: str | None = None,
    executable_roots: list[str] | None = None,
) -> str:
    """Build the full seatbelt policy with workspace-specific rules."""
    if hermes_home is None:
        hermes_home = str(Path.home() / ".hermes")

    workspace_root_escaped = _quote_seatbelt_path(workspace_root)
    hermes_home_escaped = _quote_seatbelt_path(hermes_home)

    dynamic_policy = f"""
; Workspace access
(allow file-read* file-write* file-test-existence
  (subpath "{workspace_root_escaped}"))

; Deny entire hermes home directory (config.yaml, .env, gateway_state, credentials)
; This takes precedence over the workspace allow above when hermes_home is inside workspace_root.
(deny file-read* file-write* (subpath "{hermes_home_escaped}"))
"""
    return "\n".join([
        _SEATBELT_BASE_POLICY,
        _SEATBELT_PLATFORM_DEFAULTS,
        _build_executable_roots_policy(executable_roots),
        dynamic_policy,
    ])


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
    ) -> SandboxResult:
        policy = _build_seatbelt_policy(workspace_root, hermes_home)
        argv = [_SEATBELT_EXECUTABLE, "-p", policy, "--"] + command
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
            policy = _build_seatbelt_policy(str(snapshot.workspace_root))
        else:
            policy = _build_seatbelt_policy(
                str(snapshot.workspace_root),
                executable_roots=executable_roots,
            )
        sandboxed_cmd = [_SEATBELT_EXECUTABLE, "-p", policy, "--"] + sandbox_command
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
