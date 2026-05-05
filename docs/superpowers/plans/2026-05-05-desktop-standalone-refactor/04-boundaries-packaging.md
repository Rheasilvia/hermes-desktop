# 04 — Boundaries, packaging, acceptance (Tasks 34–38)

> Implements spec sections `01-architecture.md §"Boundary rules"`,
> `05-implementation-notes.md §"Packaging"`, and the acceptance
> criteria from `05-implementation-notes.md §"Acceptance"`.
>
> Working directory varies per task; each step states it explicitly.

---

## Task 34: ESLint `no-restricted-imports` boundary rules

**Files:**
- Modify: `desktop/eslint.config.js`
- Create: `desktop/src/services/api/__tests__/boundaries.test.ts`

- [ ] **Step 1: Add restricted-imports rule to ESLint flat config**

In `desktop/eslint.config.js`, append a section that applies to
`desktop/src/**` (excluding `desktop/src/services/api/**`):

```js
// desktop/eslint.config.js (excerpt)
export default [
  // ... existing entries ...
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/services/api/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [
          {
            name: "@/services/gateway",
            message: "Model/Cron stores must use @/services/api (D7).",
          },
        ],
        patterns: [
          {
            group: ["@/services/gateway/*"],
            message: "Model/Cron stores must use @/services/api (D7).",
          },
          {
            group: ["@/services/api/transports/*", "@/services/api/http-client"],
            message: "Use the api registry (@/services/api), not transports directly.",
          },
        ],
      }],
    },
  },
];
```

- [ ] **Step 2: Add a positive ESLint test fixture**

Create `desktop/src/services/api/__tests__/boundaries.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as api from "@/services/api";

describe("api registry boundary", () => {
  it("exposes only domain accessors", () => {
    expect(typeof api.cron).toBe("function");
    expect(typeof api.model).toBe("function");
    expect(typeof api.overlays).toBe("function");
    expect(typeof api.settings).toBe("function");
    expect(typeof api.state).toBe("function");
  });
});
```

- [ ] **Step 3: Run lint + test, expect PASS**

```bash
cd desktop
npm run lint
npm run test -- src/services/api/__tests__/boundaries.test.ts
```

- [ ] **Step 4: Negative fixture, confirm lint flags it**

Temporarily create `desktop/src/modules/cron/_lint_probe.ts` with the
single line `import "@/services/gateway/cron";` and run
`npm run lint`. Expected: ESLint reports the `no-restricted-imports`
violation. Delete the probe file before committing.

- [ ] **Step 5: Commit**

```bash
git add desktop/eslint.config.js desktop/src/services/api/__tests__/boundaries.test.ts
git commit -m "chore(eslint): forbid services/gateway and api/transports outside services/api"
```

---

## Task 35: Grep CI for upstream Python imports + snapshot header

**Files:**
- Create: `desktop/backend/scripts/check_boundaries.sh`
- Create: `desktop/backend/tests/test_boundary_grep.py`

- [ ] **Step 1: Write the boundary script**

Create `desktop/backend/scripts/check_boundaries.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="$ROOT/desktop_backend"

FORBIDDEN='^(from|import) +(hermes_cli|cron|agent|tui_gateway|web)\b'
if grep -RIEn "$FORBIDDEN" "$PKG" --include='*.py'; then
  echo "ERROR: desktop_backend must not import upstream modules (D6)" >&2
  exit 1
fi

shopt -s nullglob
missing=0
for f in "$PKG/readers"/*.py; do
  base="$(basename "$f")"
  [ "$base" = "__init__.py" ] && continue
  if ! head -n 5 "$f" | grep -q '^# SNAPSHOT:'; then
    echo "ERROR: missing SNAPSHOT header: $f" >&2
    missing=$((missing + 1))
  fi
done
[ "$missing" -gt 0 ] && exit 1
echo "OK: no upstream imports; all readers carry SNAPSHOT header."
```

`chmod +x desktop/backend/scripts/check_boundaries.sh`.

- [ ] **Step 2: Pytest wrapper**

Create `desktop/backend/tests/test_boundary_grep.py`:

```python
import subprocess
from pathlib import Path


def test_check_boundaries_script_passes():
    script = Path(__file__).parent.parent / "scripts" / "check_boundaries.sh"
    result = subprocess.run([str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
```

- [ ] **Step 3: Run, expect PASS**

```bash
cd desktop/backend
pytest tests/test_boundary_grep.py -v
```

- [ ] **Step 4: Negative — verify the script fails on a violation**

Add `import hermes_cli` to a throwaway file
`desktop/backend/desktop_backend/_probe.py`, re-run
`bash desktop/backend/scripts/check_boundaries.sh`. Expected: exit
code 1 with the D6 error. Delete the probe.

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/scripts/check_boundaries.sh desktop/backend/tests/test_boundary_grep.py
git commit -m "test(backend): grep CI for upstream imports + SNAPSHOT header"
```

---

## Task 36: PyInstaller `--onedir` recipe

**Files:**
- Create: `desktop/backend/desktop_backend.spec`
- Create: `desktop/backend/scripts/build_dist.sh`
- Modify: `desktop/backend/pyproject.toml`

- [ ] **Step 1: Add the build extra**

In `desktop/backend/pyproject.toml`:

```toml
[project.optional-dependencies]
build = ["pyinstaller==6.6.0"]
```

- [ ] **Step 2: PyInstaller spec**

Create `desktop/backend/desktop_backend.spec`:

```python
from PyInstaller.utils.hooks import collect_submodules

block_cipher = None

hiddenimports = (
    collect_submodules("desktop_backend")
    + collect_submodules("uvicorn")
    + collect_submodules("fastapi")
    + collect_submodules("pydantic")
)

a = Analysis(
    ["desktop_backend/__main__.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "test", "unittest"],
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)
exe = EXE(
    pyz, a.scripts, [],
    exclude_binaries=True,
    name="desktop_backend",
    debug=False, bootloader_ignore_signals=False,
    strip=False, upx=False, console=True,
)
coll = COLLECT(
    exe, a.binaries, a.zipfiles, a.datas,
    strip=False, upx=False, name="desktop_backend",
)
```

- [ ] **Step 3: Build wrapper**

Create `desktop/backend/scripts/build_dist.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python -m venv .venv-build
source .venv-build/bin/activate
pip install -e ".[build]"
rm -rf build dist
pyinstaller desktop_backend.spec --noconfirm

TMP_HOME="$(mktemp -d)"
HERMES_HOME="$TMP_HOME/.hermes" ./dist/desktop_backend/desktop_backend &
BPID=$!
sleep 2
kill $BPID || true
echo "Built: ./dist/desktop_backend/"
```

`chmod +x desktop/backend/scripts/build_dist.sh`.

- [ ] **Step 4: Build locally**

```bash
cd desktop/backend
bash scripts/build_dist.sh
```

Expected: `dist/desktop_backend/desktop_backend` exists; smoke test
prints `READY <port>` before being killed.

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend.spec desktop/backend/scripts/build_dist.sh desktop/backend/pyproject.toml
git commit -m "build(backend): pyinstaller onedir recipe for desktop_backend"
```

---

## Task 37: Tauri `externalBin` wiring + co-signing

**Files:**
- Modify: `desktop/src-tauri/tauri.conf.json`
- Modify: `desktop/src-tauri/src/sidecar.rs`
- Modify: `desktop/src-tauri/src/main.rs`

- [ ] **Step 1: Declare external binary**

In `desktop/src-tauri/tauri.conf.json`, under `bundle`:

```json
{
  "bundle": {
    "active": true,
    "externalBin": ["../backend/dist/desktop_backend/desktop_backend"],
    "macOS": {
      "entitlements": null,
      "signingIdentity": "-",
      "providerShortName": null
    }
  }
}
```

- [ ] **Step 2: Resolve bundled binary in release**

Append to `desktop/src-tauri/src/sidecar.rs`:

```rust
#[cfg(not(debug_assertions))]
fn release_binary(handle: &tauri::AppHandle) -> Result<PathBuf> {
    use tauri::Manager;
    let resolver = handle.path();
    let res = resolver
        .resolve("desktop_backend/desktop_backend", tauri::path::BaseDirectory::Resource)
        .context("resolve sidecar binary")?;
    Ok(res)
}

pub async fn spawn(handle: tauri::AppHandle) -> Result<SidecarInfo> {
    #[cfg(debug_assertions)]
    { let _ = handle; spawn_dev().await }

    #[cfg(not(debug_assertions))]
    {
        let bin = release_binary(&handle)?;
        let token = write_token()?;
        let mut cmd = Command::new(bin);
        cmd.env("HERMES_HOME", hermes_home());
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());
        let mut child = cmd.spawn().context("failed to spawn sidecar")?;
        let stdout = child.stdout.take().ok_or_else(|| anyhow!("no stdout"))?;
        let mut reader = BufReader::new(stdout).lines();
        let port = timeout(Duration::from_secs(5), async {
            while let Some(line) = reader.next_line().await? {
                if let Some(rest) = line.strip_prefix("READY ") {
                    return Ok::<u16, anyhow::Error>(rest.trim().parse()?);
                }
            }
            bail!("sidecar exited before READY")
        }).await.map_err(|_| anyhow!("sidecar startup timeout"))??;

        let info = SidecarInfo { base_url: format!("http://127.0.0.1:{port}"), token };
        let s = state();
        *s.info.lock().await = Some(info.clone());
        *s.child.lock().await = Some(child);
        Ok(info)
    }
}
```

Update `main.rs` setup to call `sidecar::spawn(handle.clone())`
instead of `sidecar::spawn_dev()` so dev/release dispatch through one
entry point.

- [ ] **Step 3: Build a release `.app`**

```bash
cd desktop/backend && bash scripts/build_dist.sh
cd ../ && npm run tauri:build
```

Expected: `desktop/src-tauri/target/release/bundle/macos/Hermes.app`
exists. `codesign -dv --verbose=4 Hermes.app` reports a single
identity covering both the app and the embedded `desktop_backend`
binary (D4: single Gatekeeper authorization).

- [ ] **Step 4: Smoke-test the bundle**

```bash
open desktop/src-tauri/target/release/bundle/macos/Hermes.app
```

Expected: app launches without a Gatekeeper re-prompt for the
sidecar; in the dev console, `invoke('sidecar_info')` returns
`{base_url, token}`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src-tauri/tauri.conf.json desktop/src-tauri/src/sidecar.rs desktop/src-tauri/src/main.rs
git commit -m "feat(tauri): externalBin + release sidecar resolution with co-signing"
```

---

## Task 38: Acceptance verification script

**Files:**
- Create: `desktop/scripts/verify_acceptance.sh`

- [ ] **Step 1: Write the script**

Create `desktop/scripts/verify_acceptance.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"

echo "== A1: backend boundaries =="
bash "$REPO/desktop/backend/scripts/check_boundaries.sh"

echo "== A2: backend tests =="
( cd "$REPO/desktop/backend" && pytest -q )

echo "== A3: frontend lint =="
( cd "$REPO/desktop" && npm run lint )

echo "== A4: frontend tests =="
( cd "$REPO/desktop" && npm run test -- --run )

echo "== A5: tauri rust tests =="
( cd "$REPO/desktop/src-tauri" && cargo test --quiet )

echo "== A6: build sidecar dist =="
( cd "$REPO/desktop/backend" && bash scripts/build_dist.sh )

echo "== A7: tauri release build =="
( cd "$REPO/desktop" && npm run tauri:build )

echo
echo "ALL ACCEPTANCE CHECKS PASSED."
```

`chmod +x desktop/scripts/verify_acceptance.sh`.

- [ ] **Step 2: Run end-to-end**

```bash
bash desktop/scripts/verify_acceptance.sh
```

Expected: every section prints PASS/OK and the final
`ALL ACCEPTANCE CHECKS PASSED.` line.

- [ ] **Step 3: Update plan README status**

In `docs/superpowers/plans/2026-05-05-desktop-standalone-refactor/README.md`,
check the boxes under `## Status` for each completed section.

- [ ] **Step 4: Commit**

```bash
git add desktop/scripts/verify_acceptance.sh docs/superpowers/plans/2026-05-05-desktop-standalone-refactor/README.md
git commit -m "chore(desktop): acceptance verification script"
```

---

## Section checkpoint

After Task 38:
- `bash desktop/scripts/verify_acceptance.sh` exits 0.
- Sidecar binary is co-signed with the `.app` (single Gatekeeper
  prompt on first launch).
- ESLint forbids `services/gateway/*` and direct
  `services/api/transports/*` imports outside `services/api/`.
- `desktop_backend` carries no upstream Python imports, and every
  reader copy carries a `# SNAPSHOT:` header.
- All acceptance criteria from
  `05-implementation-notes.md §"Acceptance"` are mechanically
  verifiable from a single command.
