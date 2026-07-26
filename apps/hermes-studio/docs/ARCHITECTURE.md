# Hermes Studio Architecture

Hermes Studio is an Electron application with a SolidJS renderer and a
desktop-owned Python sidecar. This document describes the implementation that
is active during the Electron migration. The renderer bridge remains a later
migration stage; the lifecycle below is already owned by Electron main.

## Sidecar lifecycle

Electron main creates one `SidecarManager` and is the only owner of its process.
In development it runs this command from `apps/hermes-studio`:

```bash
uv run --directory sidecar python -m daemon
```

In a packaged app it runs
`process.resourcesPath/sidecar/daemon` (`daemon.exe` on Windows). The manager
sets `DESKTOP_BACKEND_PORT=0`, generates separate cryptographically random API
and workspace-grant tokens, and waits for `READY <actual-port>` on stdout. The
workspace grant remains private to main; Task 2 does not add a renderer bridge.

The Python process binds only `127.0.0.1`. Uvicorn's bound socket is the source
of the announced port, eliminating the reserve-then-bind race. Main constructs
the backend URL itself as `http://127.0.0.1:<port>` and probes
`/desktop/api/health` on loopback.

Three consecutive failed probes trigger a restart. Restart delays are
exponential (1, 2, 4, 8, 16 seconds, capped at 30 seconds), with no more than
five attempts in a rolling 60-second window. An initial spawn, READY timeout,
or pre-READY exit opens the shell in degraded mode and enters that same bounded
background recovery policy. Shutdown waits for any in-flight restart cleanup
and prevents a delayed restart from spawning a new child. It targets only the
child created by the manager: a detached process group on POSIX or `taskkill
/PID <owned-pid> /T /F` on Windows. No process-name-wide kill is used.

Sidecar stderr is appended to
`$HERMES_HOME/logs/hermes-studio.log` (default `~/.hermes`). Known generated
secrets, Authorization values, URL credentials, and common token/key/password
parameters are redacted before writing.

## Packaging boundary

PyInstaller builds only for the runner's native OS and architecture. The build
entry stages exactly one executable at `sidecar/dist/electron/daemon[.exe]`;
the staging directory is cleared first so an executable from another host
cannot leak into the package. electron-builder copies it to the packaged
`resources/sidecar` directory.
`node-pty` native files are unpacked from ASAR. Cross-compiling a PyInstaller
binary by pretending to be another host is unsupported; CI must use native
macOS, Windows, and Linux runners.
