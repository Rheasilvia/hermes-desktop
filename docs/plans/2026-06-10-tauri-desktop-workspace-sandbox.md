# Tauri Desktop Workspace Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Tauri Desktop enforce a real workspace boundary for file, terminal, process, delegation, and code execution paths.

**Architecture:** Keep the new behavior desktop-local under `desktop/`. Do not modify upstream/shared `tools/`, `apps/desktop/`, Electron, or TUI defaults. Add a desktop policy layer, install desktop-only tool overrides in the sidecar, wrap `delegate_task` child-agent creation, and require OS sandboxing before enabling `execute_code`.

**Tech Stack:** Python FastAPI sidecar, Hermes tool registry, Tauri Rust commands, pytest, Rust unit tests, macOS sandbox runner first.

---

## Non-Negotiable Constraints

- Only edit `desktop/` unless a missing extension point makes that impossible. If shared `tools/`, `model_tools.py`, `run_agent.py`, TUI, or `apps/desktop/` appear necessary, stop and report the exact missing hook before editing them.
- Treat `desktop/` as the local Tauri Desktop target. Treat `apps/desktop/` as upstream Electron reference code only.
- `cwd` is only a relative path base. It is not a security boundary.
- The security boundary is canonical path containment under the frozen workspace root.
- No policy snapshot means fail closed.
- `delegate_task` is handled by the agent loop, not normal registry dispatch. A registry override alone will not protect child agents.
- `execute_code` must use OS sandboxing in V1. If the sandbox runner is unavailable, do not expose or execute `execute_code`.

## Current Repo Facts To Preserve

- Tauri Rust commands live under `desktop/src-tauri/src/commands/` and are registered in `desktop/src-tauri/src/lib.rs`.
- Sidecar app creation starts in `desktop/sidecar/daemon/app.py::build_app`.
- Agent creation is in `desktop/sidecar/daemon/services/agent_pool.py::_build_agent`.
- Turn execution already sets cwd context in `desktop/sidecar/daemon/services/agent_execution_service.py::_run_turn`.
- Existing desktop path helper `desktop/sidecar/daemon/services/path_validation.py::resolve_under_cwd` is useful for image paths but is not enough for tool policy.
- Shared registry supports same-name replacement with `registry.register(..., override=True)`, but this must be installed only by the desktop sidecar.

## Task 1: Add Desktop Workspace Policy

**Files:**
- Create `desktop/sidecar/daemon/services/workspace_policy.py`
- Create `desktop/sidecar/tests/test_workspace_policy.py`

- [ ] Define `WorkspacePolicySnapshot` as a frozen dataclass with:
  - `session_id: str`
  - `turn_id: str`
  - `cwd: Path`
  - `workspace_root: Path`
  - `workspace_hash: str`
  - `permission_mode: Literal["ask", "auto", "full"]`
  - `policy_version: str = "desktop-workspace-v1"`
- [ ] Define `PolicyDecision` as a frozen dataclass with:
  - `allowed: bool`
  - `requires_approval: bool`
  - `reason: str`
  - `resolved_path: Path | None = None`
  - `approval_key: str | None = None`
- [ ] Add ContextVar helpers:
  - `set_workspace_policy_snapshot(snapshot) -> Token`
  - `reset_workspace_policy_snapshot(token) -> None`
  - `get_workspace_policy_snapshot() -> WorkspacePolicySnapshot | None`
- [ ] Add `build_workspace_policy_snapshot(session_id, turn_id, cwd, permission_mode)`:
  - resolve `cwd` with `Path(cwd).expanduser().resolve(strict=True)`
  - require it to exist and be a directory
  - set both `cwd` and `workspace_root` to that canonical directory for V1
  - compute `workspace_hash` from the canonical workspace root string with SHA-256 and use the first 16 hex chars
- [ ] Add `resolve_path(snapshot, path, access)`:
  - reject empty paths
  - expand `~`
  - resolve relative paths against `snapshot.cwd`
  - canonicalize existing targets with `resolve(strict=True)`
  - for writes to new files, canonicalize the parent with `resolve(strict=True)` and then append the final name
  - require final path or canonical parent to be inside `snapshot.workspace_root`
  - return deny for escapes, including symlink escapes
- [ ] Add approval key generation in policy only:
  - format `ws:{workspace_hash}:{access}:{scope}:{value}`
  - use canonical resolved path for path approvals
  - never use caller-provided raw path in the key except as a display detail
- [ ] Tests:
  - relative path under cwd is allowed
  - absolute path under workspace is allowed
  - `../outside.txt` is denied
  - symlink pointing outside workspace is denied
  - new file under existing workspace parent is allowed
  - new file under outside parent is denied
  - missing snapshot callers can detect fail-closed behavior
  - approval keys change when workspace root changes

Run:

```bash
pytest desktop/sidecar/tests/test_workspace_policy.py -q
```

## Task 2: Freeze Policy Per Turn

**Files:**
- Modify `desktop/sidecar/daemon/services/agent_execution_service.py`
- Add tests under `desktop/sidecar/tests/`

- [ ] In `_run_turn`, build one `WorkspacePolicySnapshot` immediately after `workspace_cwd` and `permission_mode_snapshot` are resolved.
- [ ] Install it with the existing `ExitStack`, beside `set_terminal_cwd`, `set_workspace_context`, and `set_session_cwd`.
- [ ] Store the snapshot on the agent for child-agent inheritance, for example `agent._desktop_workspace_policy_snapshot = snapshot`.
- [ ] Ensure permission mode changes are not read again mid-turn.
- [ ] Clear the agent snapshot in the same cleanup stack after the turn.
- [ ] Tests:
  - one turn uses the permission mode captured at turn start
  - changing session permission mode while a turn is running does not change the active snapshot
  - snapshot is reset after `_run_turn` exits

Run:

```bash
pytest desktop/sidecar/tests -q -k "workspace_policy or policy_snapshot"
```

## Task 3: Install Desktop-Only Tool Overrides

**Files:**
- Create `desktop/sidecar/daemon/tools/__init__.py`
- Create `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify `desktop/sidecar/daemon/app.py`
- Create `desktop/sidecar/tests/test_desktop_tool_overrides.py`

- [ ] Implement idempotent `install_desktop_tool_overrides()`:
  - call `tools.registry.discover_builtin_tools()` first
  - capture original entries with `registry.get_entry(name)` before overriding
  - store originals in a module-level `ORIGINAL_TOOLS: dict[str, ToolEntry]`
  - register same-name wrappers with `override=True`
  - guard with `_INSTALLED = False` so repeated app creation does not capture wrappers as originals
- [ ] Install overrides in `build_app()` before model prewarm and agent prewarm.
- [ ] Override normal registry-dispatched tools:
  - `read_file`
  - `write_file`
  - `patch`
  - `search_files`
  - `terminal`
  - `process`
  - `execute_code`
- [ ] Each wrapper must:
  - read `get_workspace_policy_snapshot()`
  - fail closed if missing
  - resolve relevant path/workdir arguments through `workspace_policy`
  - delegate to the captured original handler only when policy allows
  - return a JSON string matching Hermes tool behavior
- [ ] Clear model tool definition caches after registration if needed by importing `model_tools._clear_tool_defs_cache`.
- [ ] Tests:
  - install is idempotent
  - original entries are captured before override
  - wrappers fail closed without a snapshot
  - importing normal shared modules does not install desktop overrides

Run:

```bash
pytest desktop/sidecar/tests/test_desktop_tool_overrides.py -q
```

## Task 4: Enforce File Tool Policy

**Files:**
- Modify `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Add tests under `desktop/sidecar/tests/test_desktop_file_tool_policy.py`

- [ ] `read_file`:
  - resolve `args["path"]` with access `read`
  - deny outside workspace
  - pass the canonical workspace-contained path to the original handler
- [ ] `write_file`:
  - resolve `args["path"]` with access `write`
  - deny outside workspace
  - pass the canonical workspace-contained path to the original handler
- [ ] `patch`:
  - for replace mode, resolve `args["path"]` with access `write`
  - for patch mode, parse touched file paths from the V4A patch header lines and resolve each under workspace before delegation
  - deny the full patch if any touched file escapes
- [ ] `search_files`:
  - resolve `args["path"]` or default `"."` with access `read`
  - pass canonical workspace-contained path to the original handler
- [ ] Tests:
  - read/write/search inside workspace succeeds or reaches original handler
  - read/write/search outside workspace is denied before original handler
  - patch mode rejects a multi-file patch containing an escaping file

Run:

```bash
pytest desktop/sidecar/tests/test_desktop_file_tool_policy.py -q
```

## Task 5: Enforce Terminal And Process Policy

**Files:**
- Modify `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Add tests under `desktop/sidecar/tests/test_desktop_terminal_process_policy.py`

- [ ] `terminal`:
  - require `workdir`, when supplied, to resolve inside workspace
  - default workdir to snapshot cwd
  - best-effort parse explicit path tokens in command strings
  - deny obvious absolute path escapes
  - route uncertain but risky commands through existing approval only if permission mode allows prompting
  - pass a canonical workspace-contained workdir to the original handler
- [ ] `process`:
  - restrict process operations to desktop-owned processes or process IDs recorded by the desktop session
  - deny arbitrary host process control
  - require any process cwd/path argument to resolve inside workspace
- [ ] Tests:
  - terminal with workspace workdir reaches original handler
  - terminal with outside workdir is denied
  - terminal command containing an obvious outside absolute path is denied
  - process operation on unknown PID is denied

Run:

```bash
pytest desktop/sidecar/tests/test_desktop_terminal_process_policy.py -q
```

## Task 6: Wrap Delegate Task Child-Agent Construction

**Files:**
- Modify `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Add tests under `desktop/sidecar/tests/test_desktop_delegate_policy.py`

- [ ] Do not rely on registry override for `delegate_task`.
- [ ] During `install_desktop_tool_overrides()`, import `tools.delegate_tool` and wrap `_build_child_agent`.
- [ ] The wrapper must call the original `_build_child_agent`, then copy the parent desktop policy snapshot onto the child agent.
- [ ] The wrapper must set child workspace/session cwd attributes from the parent snapshot.
- [ ] The wrapper must not let child tasks widen workspace root, cwd, permission mode, or tool access.
- [ ] Preserve existing delegation behavior:
  - max concurrent children
  - spawn depth
  - progress callbacks
  - interrupt behavior
  - role downgrade behavior
- [ ] Tests:
  - single delegated child inherits snapshot
  - batch delegated children inherit snapshot
  - orchestrator child inherits snapshot
  - child toolsets cannot add capabilities missing from parent

Run:

```bash
pytest desktop/sidecar/tests/test_desktop_delegate_policy.py -q
```

## Task 7: Add OS Sandbox Runner For Execute Code

**Files:**
- Create `desktop/sidecar/daemon/services/sandbox_runner.py`
- Modify `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Add tests under `desktop/sidecar/tests/test_desktop_execute_code_sandbox.py`

- [ ] Define a runner interface that accepts:
  - command
  - args
  - cwd
  - env
  - timeout
  - policy snapshot
- [ ] Implement macOS first.
- [ ] Generate a sandbox profile that:
  - allows read/write under `snapshot.workspace_root`
  - allows necessary temp/runtime paths for Python startup
  - denies sibling repos
  - denies user home secrets such as `.hermes/.env`
  - denies broad filesystem reads outside approved roots
- [ ] The desktop `execute_code` override must:
  - require an active policy snapshot
  - require sandbox runner availability
  - fail closed with JSON error when unavailable
  - run local Python code only through the sandbox runner
- [ ] Keep execute-code RPC tool calls routed through desktop-overridden tools.
- [ ] Tests:
  - `open()` inside workspace succeeds
  - direct `open()` outside workspace fails
  - direct read of sibling repo fails
  - direct read of `.hermes/.env` fails
  - sandbox unavailable returns a clear JSON error and does not call original handler

Run:

```bash
pytest desktop/sidecar/tests/test_desktop_execute_code_sandbox.py -q
```

## Task 8: Fix Tauri Rust Workspace And HERMES_HOME Boundaries

**Files:**
- Modify `desktop/src-tauri/src/commands/workspace.rs`
- Modify `desktop/src-tauri/src/commands/hermes_home.rs`
- Modify `desktop/src-tauri/src/commands/platform.rs`
- Modify `desktop/src-tauri/src/lib.rs`

- [ ] Add a Rust helper equivalent to `resolve_under_root(root, path, expected_kind)`:
  - canonicalize root
  - resolve relative path under root
  - canonicalize existing target
  - for write targets, canonicalize parent before append
  - reject if final path is outside root
- [ ] `list_workspace_children`:
  - resolve `path` under `root` when relative
  - reject escapes before `read_dir`
- [ ] `read_workspace_file`:
  - resolve `path` under `root` when relative
  - reject escapes before opening
- [ ] `hermes_home::write_file`:
  - canonicalize `HERMES_HOME`
  - canonicalize/create parent safely
  - reject writes whose parent escapes `HERMES_HOME`
- [ ] `hermes_home::list_dir`:
  - canonicalize target directory
  - reject directories outside `HERMES_HOME`
- [ ] Remove arbitrary `spawn_process` from public invoke handlers or make it internal-only with a narrow allowlist.
- [ ] Ensure `reveal_in_finder` is only usable for workspace-contained paths when called from workspace UI.
- [ ] Rust tests:
  - relative workspace paths resolve under root, not process cwd
  - `../` escape is rejected
  - symlink escape is rejected
  - HERMES_HOME write escape is rejected
  - HERMES_HOME list escape is rejected

Run:

```bash
cd desktop/src-tauri
cargo test
```

## Final Verification

- [ ] Run focused Python tests:

```bash
pytest desktop/sidecar/tests -q -k "workspace_policy or desktop_tool or delegate_policy or execute_code_sandbox or terminal_process"
```

- [ ] Run focused Rust tests:

```bash
cd desktop/src-tauri
cargo test
```

- [ ] Run a manual desktop smoke test:
  - start Tauri Desktop
  - create/open a session with workspace A
  - read/search/write inside workspace A succeeds
  - attempt to read sibling repo B fails
  - terminal command with outside absolute path fails or prompts according to policy
  - delegated child cannot read outside workspace A
  - `execute_code` direct Python `open()` outside workspace A fails

## Acceptance Criteria

- Desktop workspace boundary is enforced from both Rust invoke paths and Python tool paths.
- Tauri Desktop no longer treats process cwd as implicit authority.
- `delegate_task` children inherit the same frozen workspace policy as the parent turn.
- `execute_code` cannot bypass policy via direct Python filesystem APIs.
- No shared upstream `tools/`, Electron `apps/desktop/`, or TUI behavior changes are introduced.
