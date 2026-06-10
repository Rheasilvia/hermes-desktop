from __future__ import annotations
import json
import logging
import threading as _threading
from typing import Any

log = logging.getLogger(__name__)

_INSTALLED = False
ORIGINAL_TOOLS: dict[str, Any] = {}  # name -> ToolEntry
_DELEGATE_PATCHED = False
_execute_code_popen_lock = _threading.Lock()

# Process ownership registry: proc_id -> {workspace_hash, session_id}
_desktop_process_registry: dict[str, dict] = {}
_desktop_process_registry_lock = _threading.Lock()


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
            if not decision.allowed:
                return json.dumps({"error": f"{name} denied: {decision.reason}", "code": "WORKSPACE_VIOLATION"})
            new_args = {**args, "path": str(decision.resolved_path)} if isinstance(args, dict) else args
            return original_entry.handler(new_args, **kwargs)

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
            if not decision.allowed:
                return json.dumps({"error": f"{name} denied: {decision.reason}", "code": "WORKSPACE_VIOLATION"})
            new_args = {**args, "path": str(decision.resolved_path)} if isinstance(args, dict) else args
            return original_entry.handler(new_args, **kwargs)

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
                return original_entry.handler(new_args, **kwargs)

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
                return original_entry.handler(args, **kwargs)

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

        _OUTSIDE_ABS_PATH_RE = re.compile(r'(?<![/\w])(/(?!tmp/|var/tmp/|private/tmp/)[^\s;|&>]+)')

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
                    candidate = match.group(1)
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
            if command:
                import re as _re
                _cmd_str = str(command)
                # Extract path-like tokens that contain ../ or ..\
                for _token in _re.findall(r'[^\s;|&>]*\.\.[/\\][^\s;|&>]*', _cmd_str):
                    try:
                        from pathlib import Path as _Path2
                        _candidate = (_Path2(snapshot.cwd) / _token).resolve()
                        if _candidate.exists():
                            try:
                                _candidate.relative_to(snapshot.workspace_root)
                            except ValueError:
                                return json.dumps({
                                    "error": f"terminal denied: command contains relative escape path {_token}",
                                    "code": "WORKSPACE_VIOLATION",
                                })
                    except Exception:
                        pass  # don't block on parse errors

            # 4. Pass through with canonical workdir
            new_args = {**args, "workdir": str(decision.resolved_path)}
            return original_entry.handler(new_args, **kwargs)

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
                    with _desktop_process_registry_lock:
                        owner_info = _desktop_process_registry.get(str(proc_id))
                    if owner_info is None or owner_info.get("workspace_hash") != snapshot.workspace_hash:
                        return json.dumps({
                            "error": f"process denied: process {proc_id!r} is not owned by this workspace session",
                            "code": "PROCESS_NOT_OWNED",
                        })

            # Call original handler
            result_str = original_entry.handler(args, **kwargs)

            # After a successful spawn/start, register the new process ID
            if action in ("spawn", "start", ""):
                try:
                    import json as _json
                    result_obj = _json.loads(result_str)
                    new_proc_id = (
                        result_obj.get("id")
                        or result_obj.get("session_id")
                        or result_obj.get("process_id")
                    )
                    if new_proc_id:
                        with _desktop_process_registry_lock:
                            _desktop_process_registry[str(new_proc_id)] = {
                                "workspace_hash": snapshot.workspace_hash,
                                "session_id": snapshot.session_id,
                            }
                except Exception:
                    pass  # don't fail if result is not JSON or has no id

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

            # Temporarily patch subprocess.Popen inside code_execution_tool so the
            # child Python process is spawned through the macOS seatbelt sandbox.
            # The lock serializes the patch to avoid races between concurrent turns.
            import tools.code_execution_tool as _cet

            def _sandboxed_popen(command, *, cwd=None, env=None, stdin=None,
                                  stdout=None, stderr=None, text=False,
                                  encoding=None, errors=None, preexec_fn=None,
                                  **kw):
                return runner.popen(
                    command,
                    snapshot=snapshot,
                    cwd=cwd,
                    env=env,
                    stdin=stdin,
                    stdout=stdout,
                    stderr=stderr,
                    text=text,
                    encoding=encoding,
                    errors=errors,
                    preexec_fn=preexec_fn,
                )

            with _execute_code_popen_lock:
                original_popen = _cet.subprocess.Popen
                _cet.subprocess.Popen = _sandboxed_popen
                try:
                    return original_entry.handler(args, **kwargs)
                finally:
                    _cet.subprocess.Popen = original_popen

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
