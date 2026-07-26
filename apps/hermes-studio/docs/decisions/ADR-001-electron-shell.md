# ADR-001: Electron is the Hermes Studio application shell

- Status: Accepted
- Date: 2026-07-26
- Decision owners: Hermes Studio maintainers

## Context

Hermes Studio began as a SolidJS renderer hosted by a Rust-based desktop
shell. The product has since moved to an Electron host while retaining the
SolidJS renderer and the Studio-owned Python sidecar. Several documents still
described the former host and the former `desktop/` application path as the
current implementation. That ambiguity made security ownership, packaging,
runtime commands, and contributor guidance disagree with the code that ships.

The repository also contains `apps/desktop`, a separate Electron + React chat
application inherited from upstream Hermes Agent. It is useful as a reference,
but it is not Hermes Studio and is not a runtime dependency of Studio.

## Decision

Hermes Studio uses this architecture:

1. `apps/hermes-studio` is the canonical product directory and product name.
2. Electron main owns native capabilities and lifecycle: the Python sidecar,
   filesystem access, PTY sessions, clipboard, notifications, window behavior,
   and application packaging.
3. Preload exposes the frozen, typed `window.hermesStudio` API. The renderer
   receives neither Node.js, raw Electron APIs, nor a generic IPC primitive.
4. The SolidJS renderer communicates with the sidecar over loopback REST and
   SSE. Electron creates the ephemeral credential, starts and supervises the
   sidecar, and injects connection details through the typed bridge.
5. A bridge-absent Vite renderer may use the documented development/test
   fallback. A packaged renderer treats bridge presence as authoritative and
   never accepts a backend URL or secret from page-controlled state.
6. Host-native Electron packages are the supported distribution artifacts.
   Packaging, signing, and release validation follow
   [RELEASE.md](../RELEASE.md).
7. Studio has an independent application and installation identity:
   electron-builder `appId` `com.hermes-agent.studio`, product/executable name
   `Hermes Studio`, Windows AppUserModelID `com.hermes-agent.studio`, and an
   Electron `userData` directory named `hermes-studio-electron`. These values
   are intentionally distinct from the upstream Desktop product in
   `apps/desktop` (`com.nousresearch.hermes`, product name `Hermes`). Both can
   therefore be installed without one replacing the other.
8. There is no migration of prior local UI state. Studio reads only its
   `hermes.studio.*` storage namespace and dedicated Electron `userData`;
   neither former-shell local state nor `apps/desktop` UI state is imported,
   rewritten, or deleted. This does not copy or fork Hermes runtime data:
   the selected profile under `HERMES_HOME` remains shared Hermes data.
9. Version 1 has no updater bridge, update UI, or in-app installation path.
   Packages are installed or replaced through the distribution channel.
10. Documents that describe the former shell or former application path are
   historical records. They live under [docs/history](../history/) with an
   explicit superseded status and must not be used as current guidance.
11. Studio does not adopt or embed the upstream Desktop client in
   `apps/desktop`; that remains a separate React application and reference.
12. The former `src-tauri` source tree has been deleted. It is represented only
    by explicitly superseded historical documents and is not retained as a
    comparison tree, runtime, build target, or architectural authority.

The sidecar permits one active turn per session. A second prompt for the same
session returns `SESSION_BUSY` with HTTP `409`; selected session mutations are
also blocked while that session runs. A Studio process has one active profile,
although separate sessions in that profile may run independently. Studio and
the upstream Desktop can coexist against the same Hermes profile, but there is
no cross-client lock for profile/config writes and concurrent control of the
same session is unsupported. Use separate profiles for concurrent app testing,
or at minimum separate sessions and no simultaneous profile mutation.

## Consequences

- Native capabilities must be added through narrow typed bridge methods with
  validation in Electron main and explicit tests at the trust boundary.
- Studio must remain independently buildable; it does not import the upstream
  `apps/desktop` renderer or its runtime state.
- Installing Studio does not upgrade, replace, or migrate upstream Desktop.
  Shared Hermes sessions/configuration remain visible only because both apps
  may resolve the same `HERMES_HOME`, not because their application state is
  coupled.
- Documentation, automation, and release instructions use
  `apps/hermes-studio` and the Electron command surface.
- A documentation consistency check guards canonical paths, documented npm
  commands, relative links, and accidental reactivation of retired guidance.
- Reintroducing a retired native source tree or a second active host requires a
  new ADR and a concrete supported consumer.

## Alternatives considered

### Continue the former Rust shell

Rejected. It would preserve two competing host descriptions and two packaging
paths after Electron became the implementation that owns native capability and
release behavior.

### Rebuild Studio on `apps/desktop`

Rejected. That application is a distinct React and assistant-ui product
surface. Reusing it would replace Studio's SolidJS UI and couple two clients
with different state and backend contracts.

### Expose Node integration or a generic IPC channel

Rejected. A broad primitive would erase the renderer trust boundary. The
frozen preload API keeps privilege reviewable, validated, and testable.

### Make the browser fallback a production transport

Rejected. Page-controlled connection data would weaken sidecar authentication
and make packaged behavior depend on renderer state.

### Replace REST/SSE with local JSON-RPC

Deferred. JSON-RPC over a Unix domain socket (UDS) on macOS/Linux and a Named
Pipe on Windows could remove the loopback HTTP listener, but it would also add
a second protocol, platform-specific connection lifecycle, renderer adapter,
and packaged acceptance matrix while the authenticated REST/SSE contract is
already functional. Revisit only when a concrete security, performance, or
multi-window requirement cannot be met by the current transport; do not run
both transports speculatively.

## Superseded records

These documents are preserved for context, not implementation guidance:

- [Bridge architecture proposal](../history/ARCHITECTURE-bridge-design.md)
- [Desktop API contract inventory](../history/desktop-api-contracts.md)
- [Electron-to-former-shell port roadmap](../history/electron-to-tauri-port-roadmap.md)
- [P0 TUI parity implementation plan](../history/desktop-p0-tui-parity.md)
- [TUI parity todo](../history/TODO-TUI-PARITY.md)
- [Claude Desktop technology survey](../history/claude-desktop-tech-stack.md)
- [Desktop conversation real-data plan](../../../../plans/desktop-conversation-real-data.md)
- [Git diff panel design](../../../../docs/plans/2026-05-11-git-diff-panel-design.md)
- [Workspace sandbox plan](../../../../docs/plans/2026-06-10-tauri-desktop-workspace-sandbox.md)
- [Workspace sandbox V2 plan](../../../../docs/plans/2026-06-10-tauri-desktop-workspace-sandbox-v2.md)
