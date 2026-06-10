# Tauri Desktop Workspace Sandbox V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the second-round gaps in Tauri Desktop workspace containment so file tools, patch/search, terminal/process, delegation, execute_code, and Rust workspace commands cannot escape the frozen workspace root.

**Architecture:** Keep all implementation desktop-local under `desktop/`. Do not modify upstream/shared `tools/`, `model_tools.py`, `run_agent.py`, `ui-tui/`, or `apps/desktop/`; if a missing extension point makes a shared edit unavoidable, stop and report the exact blocker first. Treat `cwd` only as the relative-path base; the security boundary is canonical containment under a per-turn `WorkspacePolicySnapshot.workspace_root`, with macOS `sandbox-exec` as the local subprocess backstop.

**Tech Stack:** Python FastAPI sidecar, Hermes tool registry runtime overrides, ContextVar turn policy, macOS seatbelt sandbox runner, Tauri Rust commands, pytest, Cargo tests.

---

## V2 Security Contract

- Workspace root is frozen at turn start and is the only filesystem boundary.
- Relative paths resolve against the frozen `cwd`; they never resolve against process cwd.
- Paths outside workspace are denied and must not enter approval flow.
- `permissionMode` (`ask`, `auto`, `full`) only controls prompts for operations inside workspace; it does not grant full-disk access.
- Missing policy snapshot, failed override install, missing required tool entry, or unavailable local sandbox runner means fail closed.
- Terminal command parsing is only an early rejection layer. Local subprocess sandboxing is the enforcement backstop.
- Delegate child agents inherit the exact parent policy snapshot in the worker thread that runs `child.run_conversation`.
- V2 target platform for local OS sandboxing is macOS. On Linux/Windows local `terminal` and `execute_code` must fail closed until a platform runner exists.

## Current Findings To Fix

- `desktop/sidecar/daemon/tools/desktop_tool_overrides.py` currently checks that a sandbox runner exists for `execute_code`, then calls the original handler without using `runner.run` or `runner.popen`.
- `desktop/src-tauri/src/commands/workspace.rs` still canonicalizes relative `path` values directly, so they resolve against process cwd instead of the provided workspace root.
- `delegate_task` propagation currently copies an attribute to the child agent, but wrappers read a `ContextVar`; child execution happens in a `ThreadPoolExecutor` thread, so the policy is not active there.
- `patch` wrapper parses only `--- a/` and `+++ b/` unified diff headers, missing V4A headers such as `*** Update File:`.
- `terminal` wrapper misses relative escape tokens such as `../outside.txt`; local foreground execution goes through `LocalEnvironment._run_bash`, background through `process_registry.spawn_local`.
- `process` wrapper passes through no-path actions and does not verify that a `proc_*` session belongs to the current desktop session/workspace/task.
- `build_app()` logs override install failures and continues, which is fail-open.
- `reveal_in_finder(path)` is still path-only and can reveal arbitrary existing paths from the renderer command surface.

## Task 1: Add Red Tests For V2 Gaps

**Files:**
- Modify: `desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_delegate_policy.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_file_tool_policy.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_tool_overrides.py`
- Modify: `desktop/src-tauri/src/commands/workspace.rs`
- Modify: `desktop/src-tauri/src/commands/platform.rs`

- [ ] Add a failing execute_code test proving the wrapper calls the desktop sandbox runner when local execution is used, not just the original handler.
- [ ] Add a failing execute_code escape test where code attempts to read a sibling file outside workspace and receives a sandbox/policy error.
- [ ] Add a failing terminal foreground test for `cat ../outside.txt` from a workspace subdir.
- [ ] Add a failing terminal background test proving local `background=true` spawn is sandboxed or rejected when sandbox runner is unavailable.
- [ ] Add failing process tests proving `poll`, `log`, `wait`, `kill`, `write`, `submit`, and `close` reject process session IDs not owned by the active desktop session/workspace/task.
- [ ] Add a failing delegate test where a child thread can read inside workspace but cannot read `../outside.txt`.
- [ ] Add failing patch tests for `*** Add File: ../outside.txt`, `*** Update File: ../outside.txt`, `*** Delete File: ../outside.txt`, and `*** Move to: ../outside.txt`.
- [ ] Add a failing startup test proving override install failure raises and prevents app startup.
- [ ] Add Rust tests proving `list_workspace_children(root, "subdir")` and `read_workspace_file(root, "file.txt")` resolve under `root`, not process cwd.
- [ ] Add Rust tests proving workspace reveal rejects arbitrary absolute paths outside root.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py \
  desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py \
  desktop/sidecar/tests/unit/test_desktop_delegate_policy.py \
  desktop/sidecar/tests/unit/test_desktop_file_tool_policy.py \
  desktop/sidecar/tests/unit/test_desktop_tool_overrides.py -q

cd desktop/src-tauri && cargo test workspace:: platform::
```

Expected before implementation: the newly added tests fail for the current V1 implementation.

## Task 2: Harden Policy And Startup Failure Semantics

**Files:**
- Modify: `desktop/sidecar/daemon/services/workspace_policy.py`
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/daemon/app.py`
- Modify: `desktop/sidecar/tests/unit/test_workspace_policy.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_tool_overrides.py`

- [ ] In `build_workspace_policy_snapshot`, validate `permission_mode` against `{"ask", "auto", "full"}` and default invalid persisted values to `"auto"` only at the service boundary, not inside tool wrappers.
- [ ] Keep `resolve_path` outside-workspace decisions as hard denies with `requires_approval=False`.
- [ ] Add a policy helper for operation classification: `is_workspace_internal_approval_candidate(snapshot, access, resolved_path) -> bool`, returning true only when the resolved path is already inside workspace and the operation is write/destructive.
- [ ] In `install_desktop_tool_overrides`, require all expected originals: `read_file`, `write_file`, `patch`, `search_files`, `terminal`, `process`, `execute_code`. If any is missing, raise `RuntimeError`.
- [ ] Register all wrappers only after every original has been captured, so partial install cannot leave mixed policy state.
- [ ] In `build_app`, remove the "proceeding without enforcement" fallback and raise after logging the exception.
- [ ] Keep `_INSTALLED` idempotence, but add a test that repeated install does not capture wrappers as originals.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_workspace_policy.py \
  desktop/sidecar/tests/unit/test_desktop_tool_overrides.py -q
```

Expected after implementation: all tests pass; `rg "proceeding without enforcement|Full process-level sandboxing is a future enhancement" desktop/sidecar` returns no matches.

## Task 3: Fix Rust Workspace Command Containment

**Files:**
- Modify: `desktop/src-tauri/src/commands/workspace.rs`
- Modify: `desktop/src-tauri/src/commands/platform.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify frontend caller only if `reveal_in_finder` signature changes under `desktop/src/`

- [ ] Add `resolve_existing_under_root(root: &str, path: &str, label: &str) -> Result<PathBuf, String>`.
- [ ] The helper must canonicalize `root` first and require it to be a directory.
- [ ] If `path` is relative, join it to canonical root before canonicalizing.
- [ ] If `path` is absolute, canonicalize it directly, then require containment under canonical root.
- [ ] Use the helper in `list_workspace_children` for directory paths.
- [ ] Use the helper in `read_workspace_file` for file paths.
- [ ] Replace path-only `reveal_in_finder(path)` with a workspace-scoped command such as `reveal_workspace_path(root, path)`, or change the existing command signature to require `root`.
- [ ] Update the Tauri invoke registration and any frontend invoke call under `desktop/src/` to pass workspace root.
- [ ] Keep `spawn_process` unregistered.

Run:

```bash
cd desktop/src-tauri && cargo test
```

Expected after implementation: relative paths are resolved under the supplied root, symlink/outside escapes are rejected, and reveal cannot target arbitrary user paths.

## Task 4: Complete File And Patch Tool Enforcement

**Files:**
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_file_tool_policy.py`

- [ ] Keep `read_file`, `write_file`, and `search_files` resolving their path arguments through `workspace_policy.resolve_path`.
- [ ] For `patch` replace mode, resolve `args["path"]` as write access before delegation.
- [ ] For unified diff mode, parse `--- a/...` and `+++ b/...`, ignoring `/dev/null`.
- [ ] For V4A mode, parse every touched path from `*** Add File:`, `*** Update File:`, `*** Delete File:`, and `*** Move to:`.
- [ ] Reject patch mode when no touched paths are found but patch text is non-empty, so unknown patch formats do not pass through unchecked.
- [ ] Resolve every touched path as a write target under the frozen workspace; deny the entire patch if any touched path escapes.
- [ ] Do not call the original patch handler after a deny decision.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_file_tool_policy.py -q
```

Expected after implementation: all patch formats either resolve under workspace or fail before original handler invocation.

## Task 5: Propagate Workspace Policy Through Delegate Threads

**Files:**
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_delegate_policy.py`

- [ ] Keep the desktop-only monkey patch on `tools.delegate_tool._build_child_agent`; do not edit shared `tools/delegate_tool.py`.
- [ ] After building the child, copy the parent `_desktop_workspace_policy_snapshot` onto the child for diagnostics and nested delegation.
- [ ] Wrap `child.run_conversation` with a function that sets, for the duration of that call:
  - `workspace_policy.set_workspace_policy_snapshot(snapshot)`
  - `tools.path_approval.set_workspace_context(str(snapshot.cwd), snapshot.session_id, snapshot.turn_id, permission_mode=snapshot.permission_mode)`
  - `tools.terminal_cwd.set_terminal_cwd(str(snapshot.cwd))`
  - `agent.runtime_cwd.set_session_cwd(str(snapshot.cwd))`
- [ ] Reset every token in a `finally` block.
- [ ] Preserve the original `run_conversation` signature and return value.
- [ ] Make the wrapper idempotent by marking children that have already been wrapped.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_delegate_policy.py -q
```

Expected after implementation: child-agent tools see the parent policy snapshot inside the worker thread and fail closed on workspace escapes.

## Task 6: Add Real macOS Sandbox Execution Hooks

**Files:**
- Modify: `desktop/sidecar/daemon/services/sandbox_runner.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py`

- [ ] Extend `MacOSSandboxRunner` with `popen(command_args, *, snapshot, cwd, env, stdin, stdout, stderr, text, encoding, errors, preexec_fn)` returning a `subprocess.Popen`.
- [ ] Keep the existing `run()` API for simple synchronous calls, but implement both APIs through one policy builder.
- [ ] Seatbelt policy must allow:
  - read/write under `snapshot.workspace_root`
  - necessary Python/runtime/system reads
  - the specific temp/RPC staging paths for execute_code
  - required `/tmp` or `/private/tmp` paths only as narrowly as practical
- [ ] Seatbelt policy must deny:
  - sibling repositories
  - user home outside workspace
  - `~/.hermes/.env`
  - `~/.hermes/config.yaml`
  - arbitrary absolute file reads outside workspace
- [ ] `get_sandbox_runner()` returns `None` outside macOS or when `/usr/bin/sandbox-exec` is unavailable.
- [ ] Add unit tests that inspect the generated policy for allow/deny rules and tests that runner invocation includes `/usr/bin/sandbox-exec -p <policy> --`.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py \
  desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py -q
```

Expected after implementation: there is at least one production call site of `runner.popen` or `runner.run`; `rg "runner\\.run|runner\\.popen" desktop/sidecar/daemon` shows real use outside tests.

## Task 7: Sandbox Local Terminal And Own Background Processes

**Files:**
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/daemon/services/sandbox_runner.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py`

- [ ] Add a desktop-only install step that patches local terminal foreground spawn without editing `tools/environments/local.py`.
- [ ] For local foreground terminal, wrap the subprocess creation used by `LocalEnvironment._run_bash` so the actual shell process is created by `SandboxRunner.popen`.
- [ ] Add a desktop-only install step that patches `process_registry.spawn_local` so background local processes are created by `SandboxRunner.popen`.
- [ ] If sandbox runner is unavailable on local backend, return `SANDBOX_UNAVAILABLE` for terminal/process local execution instead of running unsandboxed.
- [ ] Preserve non-local terminal backends such as Docker/SSH/Modal/Daytona; still enforce workspace path policy before delegation.
- [ ] Maintain early checks for `workdir`, obvious absolute paths, and relative escape tokens, but do not rely on parsing as the final boundary.
- [ ] When background process creation succeeds, record ownership metadata: `process_id`, `session_id`, `turn_id`, `workspace_hash`, `task_id`.
- [ ] In the `process` wrapper, require ownership metadata to match the active snapshot for `poll`, `log`, `wait`, `kill`, `write`, `submit`, and `close`.
- [ ] For `process(action="list")`, only return processes owned by the current desktop session/workspace/task.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py -q
```

Expected after implementation: local terminal cannot read outside workspace even when the command string parser misses a path, and process sessions cannot be controlled cross-session.

## Task 8: Sandbox execute_code Instead Of Passing Through

**Files:**
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/daemon/services/sandbox_runner.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py`

- [ ] Remove the passthrough behavior from the `execute_code` wrapper.
- [ ] Reuse the shared `tools.code_execution_tool.execute_code` implementation only if the desktop wrapper can force its child Python subprocess through `SandboxRunner.popen` without editing shared source.
- [ ] Preferred desktop-only approach: temporarily patch the `subprocess.Popen` symbol inside `tools.code_execution_tool` for the duration of the original handler call, and only redirect the child Python script spawn. Do not redirect `subprocess.run` interpreter probes.
- [ ] The patch must be thread-safe for concurrent desktop turns: protect it with a lock or implement a desktop-local execute handler if symbol patching cannot be made safe.
- [ ] The patched Popen must verify the active workspace snapshot and require sandbox availability before spawning.
- [ ] If safe Popen patching is not feasible, implement a desktop-local execute handler that mirrors the local RPC flow and calls `SandboxRunner.popen` directly.
- [ ] In either approach, execute_code must fail closed outside macOS until a platform runner exists.
- [ ] Add a smoke test script that tries `open("../outside.txt").read()` and expects denial.
- [ ] Add a smoke test script that calls `from hermes_tools import read_file; read_file("inside.txt")` and expects success when inside workspace.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py -q
```

Expected after implementation: `execute_code` uses OS sandboxing for the actual child Python process and cannot read outside workspace directly or via subprocess shell calls.

## Task 9: Align Approval Semantics With Workspace Boundary

**Files:**
- Modify: `desktop/sidecar/daemon/services/workspace_policy.py`
- Modify: `desktop/sidecar/daemon/tools/desktop_tool_overrides.py`
- Modify: `desktop/sidecar/tests/unit/test_workspace_policy.py`
- Modify: `desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py`

- [ ] Document in code comments that approval cannot expand workspace containment.
- [ ] For file wrappers, outside workspace remains deny regardless of `permissionMode`.
- [ ] For terminal wrappers, destructive commands inside workspace may route to existing approval behavior if required by mode.
- [ ] `full` mode skips prompts for workspace-internal operations but still denies outside workspace.
- [ ] Session approval keys must include workspace hash to avoid approval reuse after switching workspace roots.

Run:

```bash
pytest desktop/sidecar/tests/unit/test_workspace_policy.py \
  desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py -q
```

Expected after implementation: tests show `full` mode does not allow `../outside.txt`, and approval requests are never emitted for workspace escapes.

## Task 10: End-To-End Verification And Handoff

**Files:**
- No implementation files unless fixing issues discovered by the checks.

- [ ] Run all desktop sandbox-related Python tests:

```bash
pytest desktop/sidecar/tests/unit/test_workspace_policy.py \
  desktop/sidecar/tests/unit/test_policy_snapshot_turn.py \
  desktop/sidecar/tests/unit/test_desktop_tool_overrides.py \
  desktop/sidecar/tests/unit/test_desktop_file_tool_policy.py \
  desktop/sidecar/tests/unit/test_desktop_terminal_process_policy.py \
  desktop/sidecar/tests/unit/test_desktop_delegate_policy.py \
  desktop/sidecar/tests/unit/test_desktop_execute_code_sandbox.py -q
```

- [ ] Run Rust tests:

```bash
cd desktop/src-tauri && cargo test
```

- [ ] Run whitespace check:

```bash
git diff --check dev...HEAD
```

- [ ] Confirm no shared upstream code was modified:

```bash
git diff --name-only dev...HEAD | rg -v '^(desktop/|docs/plans/)' && exit 1 || true
```

- [ ] Confirm the old fail-open and passthrough markers are gone:

```bash
rg "proceeding without enforcement|Full process-level sandboxing is a future enhancement" desktop && exit 1 || true
```

- [ ] Confirm sandbox runner has production call sites:

```bash
rg "runner\\.(run|popen)" desktop/sidecar/daemon
```

Expected final state: tests pass, sandbox call sites exist, outside-workspace attempts fail across tools, and diff stays under `desktop/` plus this plan file.

## Acceptance Criteria

- Tauri Desktop starts only when all desktop tool overrides and sandbox hooks install successfully.
- `execute_code` and local terminal subprocesses are sandboxed on macOS or fail closed when sandboxing is unavailable.
- File tools and patch/search cannot touch outside workspace, including symlink and V4A patch escapes.
- Delegate child agents inherit the exact parent workspace policy inside their worker thread.
- Rust workspace commands resolve relative paths under the provided root, never process cwd.
- Renderer cannot reveal arbitrary paths outside the active workspace.
- Process sessions are scoped to the active desktop session/workspace/task.
- No shared upstream tool, TUI, or Electron implementation files are changed.

## Notes For Implementing Agents

- Start from red tests. Do not trust mock-only tests for this security boundary; include at least one real-handler or smoke path per subsystem.
- Keep commits small and task-scoped.
- If a shared source edit appears necessary, stop and document the missing hook instead of editing shared files.
- This V2 plan supersedes `docs/plans/2026-06-10-tauri-desktop-workspace-sandbox.md` for second-round sandbox hardening.
