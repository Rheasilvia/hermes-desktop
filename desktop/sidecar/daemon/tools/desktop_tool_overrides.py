from __future__ import annotations
from contextlib import contextmanager as _contextmanager
import json
import logging
import os as _os
import re as _re
import threading as _threading
from pathlib import Path as _PathUtil
from typing import Any

log = logging.getLogger(__name__)

_INSTALLED = False
ORIGINAL_TOOLS: dict[str, Any] = {}  # name -> ToolEntry
_DELEGATE_PATCHED = False
# Serializes execute_code calls to prevent races on the _cet.subprocess.Popen monkey-patch.
# The patch replaces module-level subprocess references; concurrent patches from two
# threads would corrupt each other's restore. Single-session desktop use keeps this
# lock uncontested.
_execute_code_popen_lock = _threading.Lock()
# Serializes the tools.environments.local.subprocess / process_registry.subprocess
# swap shared by the terminal tool AND the file tools (#4b): both route their
# command/disk I/O through that module attribute, so one shared lock prevents one
# tool's restore from clobbering another's. Single-session desktop use keeps it
# uncontested (file I/O serializes behind it — an accepted tradeoff).
_local_subprocess_lock = _threading.Lock()

# Process ownership registry: proc_id -> {workspace_hash, session_id}.
# Entries accumulate and are never evicted — acceptable for single-session desktop use.
# TODO: wire cleanup to session_end events when multi-session support is added.
_desktop_process_registry: dict[str, dict] = {}
_desktop_process_registry_lock = _threading.Lock()
_TEMP_ENV_KEYS = ("TMPDIR", "TMP", "TEMP", "HERMES_EXECUTE_CODE_SOCKET_DIR")


@_contextmanager
def _workspace_execute_code_temp_env(snapshot: Any, code_execution_tool_module: Any):
    scratch = _PathUtil(snapshot.workspace_root) / ".hermes-sandbox"
    scratch.mkdir(parents=True, exist_ok=True)
    try:
        scratch.chmod(0o700)
    except OSError:
        pass

    scratch_str = str(scratch)
    previous_env = {key: _os.environ.get(key) for key in _TEMP_ENV_KEYS}
    previous_tempdir = code_execution_tool_module.tempfile.tempdir

    try:
        for key in _TEMP_ENV_KEYS:
            _os.environ[key] = scratch_str
        code_execution_tool_module.tempfile.tempdir = None
        yield scratch
    finally:
        for key, value in previous_env.items():
            if value is None:
                _os.environ.pop(key, None)
            else:
                _os.environ[key] = value
        code_execution_tool_module.tempfile.tempdir = previous_tempdir


def _import_required_tool_modules() -> None:
    """Import the built-in tools the desktop policy wraps.

    The normal registry discovery path scans ``tools/*.py`` on disk before
    importing modules. In a PyInstaller bundle those modules live in the PYZ
    archive, so the source-file scan can find nothing. Direct imports keep the
    desktop sidecar startup independent of that filesystem scan.
    """
    import tools.code_execution_tool  # noqa: F401
    import tools.file_tools  # noqa: F401
    import tools.process_registry  # noqa: F401
    import tools.terminal_tool  # noqa: F401


class _SandboxedSubprocessProxy:
    """Proxy a subprocess module while routing Popen through the sandbox runner."""

    def __init__(
        self,
        original_module: Any,
        runner: Any,
        snapshot: Any,
        *,
        allow_command_executable: bool = False,
    ) -> None:
        self._original_module = original_module
        self._runner = runner
        self._snapshot = snapshot
        self._allow_command_executable = allow_command_executable

    def __getattr__(self, name: str) -> Any:
        return getattr(self._original_module, name)

    def Popen(self, command, *args, **kwargs):
        if args:
            raise TypeError("desktop sandbox proxy does not support positional Popen options")
        return self._runner.popen(
            command,
            snapshot=self._snapshot,
            allow_command_executable=self._allow_command_executable,
            **kwargs,
        )


@_contextmanager
def _sandboxed_local_subprocess(snapshot: Any, runner: Any):
    """Route LocalEnvironment / process-registry subprocess spawns through the
    macOS seatbelt sandbox for the duration of the block.

    The terminal tool and the file tools both reach disk/commands via
    ``tools.environments.local.subprocess.Popen`` (file tools shell out to
    wc/head/sed/cat/python3/rg — verified: no in-process open()). Swapping that
    module attribute (and process_registry's) to a sandbox proxy makes the kernel
    re-validate every path at the command's open()/exec(), which is what closes the
    TOCTOU window between the L1 ``resolve_path`` check and the actual open. The
    swap is a process-global mutation, so ``_local_subprocess_lock`` serializes it
    across terminal + file tools (single-session desktop assumption)."""
    import tools.environments.local as _local_env
    import tools.process_registry as _process_registry

    local_subprocess = _local_env.subprocess
    registry_subprocess = _process_registry.subprocess
    proxy_for_local = _SandboxedSubprocessProxy(local_subprocess, runner, snapshot)
    proxy_for_registry = _SandboxedSubprocessProxy(registry_subprocess, runner, snapshot)

    with _local_subprocess_lock:
        _local_env.subprocess = proxy_for_local
        _process_registry.subprocess = proxy_for_registry
        try:
            yield
        finally:
            _local_env.subprocess = local_subprocess
            _process_registry.subprocess = registry_subprocess


def _run_file_tool_sandboxed(
    original_entry: Any, call_args: Any, snapshot: Any, handler_kwargs: dict
) -> str:
    """Invoke a file-tool handler, sandboxing its disk-I/O subprocess (#4b).

    File tools (read/write/patch/search) reach disk via ``ShellFileOperations`` →
    ``self.env.execute()`` → ``tools.environments.local.subprocess.Popen``. On a
    local backend with a macOS sandbox runner available, run the handler inside
    ``_sandboxed_local_subprocess`` so the kernel re-checks paths at open() time (a
    TOCTOU symlink-swap to outside the workspace is then denied by the seatbelt
    policy). Otherwise call directly: L1 ``resolve_path`` already enforced workspace
    containment, so — unlike the terminal tool, which executes arbitrary commands
    and fails closed — file tools degrade to the Python boundary on non-darwin /
    no-runner / remote backends rather than becoming unavailable."""
    try:
        import tools.terminal_tool as _terminal_tool
        env_type = (_terminal_tool._get_env_config() or {}).get("env_type", "local")
    except Exception:
        env_type = "local"

    if env_type == "local":
        from ..services.sandbox_runner import get_sandbox_runner
        runner = get_sandbox_runner()
        if runner is not None:
            with _sandboxed_local_subprocess(snapshot, runner):
                return original_entry.handler(call_args, **handler_kwargs)
    return original_entry.handler(call_args, **handler_kwargs)


def _register_process_owner(snapshot: Any, result_str: str) -> None:
    """Record a terminal(background=true) process id as owned by this desktop turn."""
    try:
        result_obj = json.loads(result_str)
    except Exception:
        return
    if not isinstance(result_obj, dict):
        return
    proc_id = (
        result_obj.get("session_id")
        or result_obj.get("id")
        or result_obj.get("process_id")
    )
    if not proc_id:
        return
    with _desktop_process_registry_lock:
        _desktop_process_registry[str(proc_id)] = {
            "workspace_hash": snapshot.workspace_hash,
            "session_id": snapshot.session_id,
        }


def _process_owned_by_snapshot(snapshot: Any, proc_id: str) -> bool:
    with _desktop_process_registry_lock:
        owner_info = _desktop_process_registry.get(str(proc_id))
    return bool(
        owner_info
        and owner_info.get("workspace_hash") == snapshot.workspace_hash
        and owner_info.get("session_id") == snapshot.session_id
    )


def _filter_process_list_for_snapshot(snapshot: Any, result_str: str) -> str:
    """Filter process(action=list) output to processes owned by this desktop session."""
    try:
        result_obj = json.loads(result_str)
    except Exception:
        return result_str
    if not isinstance(result_obj, dict) or not isinstance(result_obj.get("processes"), list):
        return result_str
    with _desktop_process_registry_lock:
        owned = {
            proc_id
            for proc_id, owner_info in _desktop_process_registry.items()
            if (
                owner_info.get("workspace_hash") == snapshot.workspace_hash
                and owner_info.get("session_id") == snapshot.session_id
            )
        }
    filtered = []
    for proc in result_obj["processes"]:
        if not isinstance(proc, dict):
            continue
        proc_id = proc.get("session_id") or proc.get("id") or proc.get("process_id")
        if proc_id and str(proc_id) in owned:
            filtered.append(proc)
    result_obj["processes"] = filtered
    return json.dumps(result_obj, ensure_ascii=False)


def install_desktop_tool_overrides() -> None:
    """Idempotent. Call once from build_app() before model/agent prewarm."""
    global _INSTALLED
    if _INSTALLED:
        return

    import tools.registry as _registry_module
    from tools.registry import registry
    import model_tools

    # Step 1: discover and import all built-in tool modules so they are registered
    _registry_module.discover_builtin_tools()
    _import_required_tool_modules()

    # Step 2: capture originals BEFORE any override
    _TOOL_NAMES = ["read_file", "write_file", "patch", "search_files",
                   "terminal", "process", "execute_code"]
    for name in _TOOL_NAMES:
        entry = registry.get_entry(name)
        if entry is None:
            raise RuntimeError(f"desktop policy: missing required tool: {name}")
        ORIGINAL_TOOLS[name] = entry

    # Step 3: register same-name wrappers with override=True
    _install_wrappers(registry)

    # Step 3b: wrap _build_child_agent to propagate desktop workspace policy to child agents
    # Best-effort: child-agent propagation degrades gracefully; process still sandboxed by parent turn.
    _install_delegate_patch()

    # Step 4: clear model tool definition caches
    model_tools._clear_tool_defs_cache()

    _INSTALLED = True


def _install_wrappers(registry) -> None:
    """Register desktop-policy wrappers for each tool. Called only once."""
    from ..services.workspace_policy import get_workspace_policy_snapshot, resolve_path

    _TOOL_WRAPPERS: dict[str, Any] = {}

    def _fail_closed(tool_name: str, args: Any) -> str:
        return json.dumps({"error": f"desktop policy: no workspace snapshot active for {tool_name}", "code": "POLICY_MISSING"})

    # Boundary note: file tools (read_file/write_file/patch/search_files) are
    # confined FIRST by workspace_policy.resolve_path — the Python path boundary
    # (L1), which canonicalizes (incl. final-component symlinks) and enforces
    # workspace containment. On a local backend with a macOS sandbox runner, the
    # handler then runs inside _sandboxed_local_subprocess (#4b): its disk-I/O
    # subprocess (ShellFileOperations shells out via the local env's Popen) is
    # wrapped in sandbox-exec, so the kernel re-validates paths at open() time and a
    # TOCTOU symlink-swap to outside the workspace is denied. Reads of permissive
    # system paths stay allowed (codex parity, by decision); HERMES_HOME stays
    # denied. On non-darwin / no-runner / remote backends, file tools fall back to
    # the L1 boundary alone — they do NOT fail closed, since L1 still guarantees
    # containment. Hardlinks remain a path-vs-inode limit shared with codex (#4c).
    # -----------------------------------------------------------------------
    # read_file / search_files: resolve path with "read" access
    # -----------------------------------------------------------------------

    def _make_file_read_wrapper(name: str):
        original_entry = ORIGINAL_TOOLS.get(name)
        if original_entry is None:
            return None

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed(name, args)
            path = args.get("path", ".") if isinstance(args, dict) else "."
            decision = resolve_path(snapshot, str(path), "read")
            # Outside-workspace denials are final — never route to approval flow.
            if not decision.allowed:
                return json.dumps({"error": f"{name} denied: {decision.reason}", "code": "WORKSPACE_VIOLATION"})
            new_args = {**args, "path": str(decision.resolved_path)} if isinstance(args, dict) else args
            return _run_file_tool_sandboxed(original_entry, new_args, snapshot, kwargs)

        return wrapper

    # -----------------------------------------------------------------------
    # write_file: resolve path with "write" access
    # -----------------------------------------------------------------------

    def _make_file_write_wrapper(name: str):
        original_entry = ORIGINAL_TOOLS.get(name)
        if original_entry is None:
            return None

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed(name, args)
            path = args.get("path", "") if isinstance(args, dict) else ""
            decision = resolve_path(snapshot, str(path), "write")
            # Outside-workspace denials are final — never route to approval flow.
            if not decision.allowed:
                return json.dumps({"error": f"{name} denied: {decision.reason}", "code": "WORKSPACE_VIOLATION"})
            new_args = {**args, "path": str(decision.resolved_path)} if isinstance(args, dict) else args
            return _run_file_tool_sandboxed(original_entry, new_args, snapshot, kwargs)

        return wrapper

    # -----------------------------------------------------------------------
    # patch: handle both replace-mode (args["path"]) and patch-mode (args["patch"])
    # -----------------------------------------------------------------------

    def _make_patch_wrapper():
        original_entry = ORIGINAL_TOOLS.get("patch")
        if original_entry is None:
            return None

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed("patch", args)

            if isinstance(args, dict) and "path" in args:
                # Replace mode: single file write
                decision = resolve_path(snapshot, str(args["path"]), "write")
                if not decision.allowed:
                    return json.dumps({"error": f"patch denied: {decision.reason}", "code": "WORKSPACE_VIOLATION"})
                new_args = {**args, "path": str(decision.resolved_path)}
                return _run_file_tool_sandboxed(original_entry, new_args, snapshot, kwargs)

            elif isinstance(args, dict) and "patch" in args:
                patch_text = args["patch"]
                touched: list[str] = []
                for line in patch_text.splitlines():
                    # Unified diff headers
                    if line.startswith("--- a/"):
                        raw = line[len("--- a/"):]
                        if raw.strip() not in ("/dev/null", ""):
                            touched.append(raw)
                    elif line.startswith("+++ b/"):
                        raw = line[len("+++ b/"):]
                        if raw.strip() not in ("/dev/null", ""):
                            touched.append(raw)
                    # V4A headers
                    elif line.startswith("*** Add File: "):
                        touched.append(line[len("*** Add File: "):].strip())
                    elif line.startswith("*** Update File: "):
                        touched.append(line[len("*** Update File: "):].strip())
                    elif line.startswith("*** Delete File: "):
                        touched.append(line[len("*** Delete File: "):].strip())
                    elif line.startswith("*** Move to: "):
                        touched.append(line[len("*** Move to: "):].strip())

                # Non-empty patch with no recognized file headers → unknown format, reject
                if not touched and patch_text.strip():
                    return json.dumps({
                        "error": "patch denied: unrecognized patch format",
                        "code": "WORKSPACE_VIOLATION",
                    })

                touched = list(dict.fromkeys(touched))  # deduplicate
                from pathlib import Path as _Path
                for raw_path in touched:
                    full = _Path(snapshot.cwd) / raw_path
                    decision = resolve_path(snapshot, str(full), "write")
                    if not decision.allowed:
                        return json.dumps({
                            "error": f"patch denied: {decision.reason} (file: {raw_path})",
                            "code": "WORKSPACE_VIOLATION",
                        })
                return _run_file_tool_sandboxed(original_entry, args, snapshot, kwargs)

            else:
                # Unknown args structure — reject; do not pass through
                return json.dumps({
                    "error": "patch denied: unrecognized argument structure",
                    "code": "WORKSPACE_VIOLATION",
                })

        return wrapper

    # -----------------------------------------------------------------------
    # terminal: workdir enforcement + best-effort command path scan
    # -----------------------------------------------------------------------

    def _make_terminal_wrapper():
        import re
        original_entry = ORIGINAL_TOOLS.get("terminal")
        if original_entry is None:
            return None

        _OUTSIDE_ABS_PATH_RE = re.compile(r'(?<![/\w])(/[^\s;|&>]+)')
        _DENIED_TEMP_PATH_PREFIXES = (
            "/tmp/",
            "/private/tmp/",
            "/var/tmp/",
            "/private/var/tmp/",
        )

        # System paths that are always safe to use in commands
        _SYSTEM_PATH_PREFIXES = (
            "/usr/bin/", "/usr/sbin/", "/usr/local/bin/", "/usr/local/sbin/",
            "/bin/", "/sbin/", "/opt/", "/System/", "/Library/",
            "/dev/", "/proc/",
        )

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed("terminal", args)

            if not isinstance(args, dict):
                return original_entry.handler(args, **kwargs)

            # 1. Resolve workdir
            workdir = args.get("workdir") or args.get("cwd") or str(snapshot.cwd)
            decision = resolve_path(snapshot, str(workdir), "read")
            if not decision.allowed:
                return json.dumps({"error": f"terminal denied: workdir {decision.reason}", "code": "WORKSPACE_VIOLATION"})

            # 2. Best-effort scan command for obvious outside absolute paths
            command = args.get("command") or args.get("cmd") or ""
            if command:
                for match in _OUTSIDE_ABS_PATH_RE.finditer(str(command)):
                    candidate = match.group(1).strip("\"'")
                    if candidate in ("/tmp", "/private/tmp", "/var/tmp", "/private/var/tmp") or any(
                        candidate.startswith(prefix) for prefix in _DENIED_TEMP_PATH_PREFIXES
                    ):
                        return json.dumps({
                            "error": f"terminal denied: command contains outside path {candidate}",
                            "code": "WORKSPACE_VIOLATION"
                        })
                    # System executables and device paths are always allowed
                    if any(candidate.startswith(prefix) for prefix in _SYSTEM_PATH_PREFIXES):
                        continue
                    # Quick check: is this path outside workspace?
                    try:
                        from pathlib import Path
                        p = Path(candidate)
                        if p.exists():
                            canonical = p.resolve()
                            try:
                                canonical.relative_to(snapshot.workspace_root)
                            except ValueError:
                                return json.dumps({
                                    "error": f"terminal denied: command contains outside path {candidate}",
                                    "code": "WORKSPACE_VIOLATION"
                                })
                    except Exception:
                        pass  # don't block on parse errors

            # 3. Check for relative escape tokens (../outside.txt)
            # Outside-workspace workdir/path denials are always hard-denied.
            # permissionMode only gates approval prompts for workspace-internal operations.
            # full mode skips prompts for workspace-internal ops but still denies outside workspace.
            if command:
                _cmd_str = str(command)
                for _token in _re.findall(r'[^\s;|&>]*\.\.[/\\][^\s;|&>]*', _cmd_str):
                    try:
                        _clean_token = _token.strip("\"'")
                        _candidate = (_PathUtil(snapshot.cwd) / _clean_token).resolve()
                        if _candidate.exists():
                            try:
                                _candidate.relative_to(snapshot.workspace_root)
                            except ValueError:
                                return json.dumps({
                                    "error": f"terminal denied: command contains relative escape path {_clean_token}",
                                    "code": "WORKSPACE_VIOLATION",
                                })
                    except Exception:
                        pass  # don't block on parse errors

            # 4. Pass through with canonical workdir. For local desktop terminal,
            # command parsing is only an early rejection layer; the subprocess
            # itself must be created through macOS seatbelt.
            new_args = {**args, "workdir": str(decision.resolved_path)}
            try:
                import tools.terminal_tool as _terminal_tool
                env_type = (_terminal_tool._get_env_config() or {}).get("env_type", "local")
            except Exception:
                env_type = "local"

            if env_type != "local":
                result_str = original_entry.handler(new_args, **kwargs)
                if bool(new_args.get("background")):
                    _register_process_owner(snapshot, result_str)
                return result_str

            if bool(new_args.get("pty")):
                return json.dumps({
                    "error": (
                        "terminal unavailable: local PTY execution is not sandboxed "
                        "in desktop; run without pty or use a non-local backend"
                    ),
                    "code": "SANDBOX_UNAVAILABLE",
                })

            from ..services.sandbox_runner import get_sandbox_runner
            runner = get_sandbox_runner()
            if runner is None:
                return json.dumps({
                    "error": "terminal unavailable: sandbox runner not available on this platform",
                    "code": "SANDBOX_UNAVAILABLE",
                })

            with _sandboxed_local_subprocess(snapshot, runner):
                result_str = original_entry.handler(new_args, **kwargs)

            if bool(new_args.get("background")):
                _register_process_owner(snapshot, result_str)
            return result_str

        return wrapper

    # -----------------------------------------------------------------------
    # process: path argument enforcement
    # -----------------------------------------------------------------------

    def _make_process_wrapper():
        original_entry = ORIGINAL_TOOLS.get("process")
        if original_entry is None:
            return None

        # Actions that require ownership verification
        _OWNERSHIP_ACTIONS = {"poll", "log", "wait", "kill", "write", "submit", "close"}

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed("process", args)

            if not isinstance(args, dict):
                return original_entry.handler(args, **kwargs)

            action = args.get("action", "")

            # If a path/cwd argument is given, verify it's inside workspace
            for path_key in ("path", "cwd", "workdir"):
                path_val = args.get(path_key)
                if path_val:
                    decision = resolve_path(snapshot, str(path_val), "read")
                    if not decision.allowed:
                        return json.dumps({
                            "error": f"process denied: {path_key} {decision.reason}",
                            "code": "WORKSPACE_VIOLATION"
                        })

            # Ownership check: poll/log/wait/kill/write/submit/close require proc ownership
            if action in _OWNERSHIP_ACTIONS:
                proc_id = args.get("id") or args.get("session_id") or args.get("process_id")
                if proc_id is not None:
                    if not _process_owned_by_snapshot(snapshot, str(proc_id)):
                        return json.dumps({
                            "error": f"process denied: process {proc_id!r} is not owned by this workspace session",
                            "code": "PROCESS_NOT_OWNED",
                        })

            # Call original handler
            result_str = original_entry.handler(args, **kwargs)

            if action == "list":
                return _filter_process_list_for_snapshot(snapshot, result_str)

            return result_str

        return wrapper

    # -----------------------------------------------------------------------
    # execute_code: require sandbox availability + fail closed without snapshot
    # -----------------------------------------------------------------------

    def _make_execute_code_wrapper():
        original_entry = ORIGINAL_TOOLS.get("execute_code")
        if original_entry is None:
            return None

        def wrapper(args, **kwargs) -> str:
            snapshot = get_workspace_policy_snapshot()
            if snapshot is None:
                return _fail_closed("execute_code", args)

            from ..services.sandbox_runner import get_sandbox_runner
            runner = get_sandbox_runner()
            if runner is None:
                return json.dumps({
                    "error": "execute_code unavailable: sandbox runner not available on this platform",
                    "code": "SANDBOX_UNAVAILABLE",
                })

            # Temporarily replace code_execution_tool's subprocess module reference
            # with a proxy so only that module's Popen is sandboxed. Assigning
            # _cet.subprocess.Popen would mutate the stdlib module object globally
            # and make sandbox_runner.popen recurse into this wrapper.
            import tools.code_execution_tool as _cet

            # COUPLING HAZARD: patches tools.code_execution_tool.subprocess (module-level attr).
            # If code_execution_tool switches to `from subprocess import Popen`, this patch stops
            # working silently. test_execute_code_calls_sandbox_runner_not_original is the regression guard.
            with _execute_code_popen_lock:
                original_subprocess = _cet.subprocess
                _cet.subprocess = _SandboxedSubprocessProxy(
                    original_subprocess,
                    runner,
                    snapshot,
                    allow_command_executable=True,
                )
                try:
                    with _workspace_execute_code_temp_env(snapshot, _cet):
                        return original_entry.handler(args, **kwargs)
                finally:
                    _cet.subprocess = original_subprocess

        return wrapper

    # -----------------------------------------------------------------------
    # Wire up wrappers
    # -----------------------------------------------------------------------

    _TOOL_WRAPPERS["read_file"] = _make_file_read_wrapper("read_file")
    _TOOL_WRAPPERS["write_file"] = _make_file_write_wrapper("write_file")
    _TOOL_WRAPPERS["patch"] = _make_patch_wrapper()
    _TOOL_WRAPPERS["search_files"] = _make_file_read_wrapper("search_files")
    _TOOL_WRAPPERS["terminal"] = _make_terminal_wrapper()
    _TOOL_WRAPPERS["process"] = _make_process_wrapper()
    _TOOL_WRAPPERS["execute_code"] = _make_execute_code_wrapper()

    for name, wrapper in _TOOL_WRAPPERS.items():
        if wrapper is None or name not in ORIGINAL_TOOLS:
            continue
        original = ORIGINAL_TOOLS[name]
        registry.register(
            name=name,
            toolset=original.toolset,
            schema=original.schema,
            handler=wrapper,
            check_fn=original.check_fn,
            requires_env=original.requires_env,
            is_async=original.is_async,
            description=original.description,
            emoji=original.emoji,
            max_result_size_chars=original.max_result_size_chars,
            dynamic_schema_overrides=original.dynamic_schema_overrides,
            override=True,
        )
        log.info("[desktop] installed policy wrapper for tool: %s", name)


# ---------------------------------------------------------------------------
# _install_delegate_patch: propagate workspace policy snapshot to child agents
# ---------------------------------------------------------------------------


def _install_delegate_patch() -> None:
    """Monkey-patch tools.delegate_tool._build_child_agent to copy parent snapshot to child.

    This prevents child agents spawned via delegate_task from widening the workspace
    boundary — they inherit the parent's WorkspacePolicySnapshot verbatim.

    The patch is idempotent via _DELEGATE_PATCHED; import failures are warned, not raised.
    """
    global _DELEGATE_PATCHED
    if _DELEGATE_PATCHED:
        return

    try:
        import tools.delegate_tool as _dt
        _orig_build_child = _dt._build_child_agent

        def _policy_build_child_agent(task_index, goal, context, toolsets, model,
                                       max_iterations, task_count, parent_agent, **kwargs):
            child = _orig_build_child(task_index, goal, context, toolsets, model,
                                      max_iterations, task_count, parent_agent, **kwargs)
            snap = getattr(parent_agent, "_desktop_workspace_policy_snapshot", None)
            if snap is not None:
                child._desktop_workspace_policy_snapshot = snap
                child.workspace_cwd = str(snap.cwd)
                child.session_cwd = str(snap.cwd)

                if getattr(child, "_desktop_policy_injected", None) is not True:
                    _orig_run_conv = child.run_conversation

                    def _sandboxed_run_conv(*args, _snap=snap, _orig=_orig_run_conv, **kwargs):
                        from ..services.workspace_policy import (
                            set_workspace_policy_snapshot,
                            reset_workspace_policy_snapshot,
                        )
                        wp_token = set_workspace_policy_snapshot(_snap)
                        pa_token = tcwd_token = rcwd_token = None
                        try:
                            import tools.path_approval as _pa
                            pa_token = _pa.set_workspace_context(
                                str(_snap.cwd), _snap.session_id, _snap.turn_id,
                                permission_mode=_snap.permission_mode,
                            )
                        except Exception:
                            pass
                        try:
                            import tools.terminal_cwd as _tcwd
                            tcwd_token = _tcwd.set_terminal_cwd(str(_snap.cwd))
                        except Exception:
                            pass
                        try:
                            import agent.runtime_cwd as _rcwd
                            rcwd_token = _rcwd.set_session_cwd(str(_snap.cwd))
                        except Exception:
                            pass
                        try:
                            return _orig(*args, **kwargs)
                        finally:
                            if rcwd_token is not None:
                                try:
                                    import agent.runtime_cwd as _rcwd
                                    _rcwd.reset_session_cwd(rcwd_token)
                                except Exception:
                                    pass
                            if tcwd_token is not None:
                                try:
                                    import tools.terminal_cwd as _tcwd
                                    _tcwd.reset_terminal_cwd(tcwd_token)
                                except Exception:
                                    pass
                            if pa_token is not None:
                                try:
                                    import tools.path_approval as _pa
                                    _pa.reset_workspace_context(pa_token)
                                except Exception:
                                    pass
                            reset_workspace_policy_snapshot(wp_token)

                    child.run_conversation = _sandboxed_run_conv
                    child._desktop_policy_injected = True

            return child

        _dt._build_child_agent = _policy_build_child_agent
        _DELEGATE_PATCHED = True
        log.info("[desktop] installed delegate_task child-agent policy patch")
    except Exception as exc:
        log.warning("[desktop] failed to install delegate_task patch: %s", exc)
