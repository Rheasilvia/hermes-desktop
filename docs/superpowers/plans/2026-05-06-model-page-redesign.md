# Model Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Main Model card, a modal picker dialog, and a configured-only provider filter to the desktop Model page.

**Architecture:** Three layers — (1) a new Python reader + two backend endpoint changes; (2) a new `getActiveModel()` transport method; (3) two new SolidJS components wired into `ModelSwitcherView`.

**Tech Stack:** Python 3.11 / FastAPI / PyYAML / pytest · TypeScript / SolidJS / CSS Modules

---

## File map

| File | Status | Responsibility |
|---|---|---|
| `desktop/backend/desktop_backend/readers/hermes_config.py` | New | Read `config.yaml` model section |
| `desktop/backend/desktop_backend/routers/model.py` | Modify | Add `GET /model/active`; add `configured_only` param |
| `desktop/backend/desktop_backend/services/merger.py` | Modify | Add `filter_configured()` |
| `desktop/backend/tests/fixtures/hermes_home/config.yaml` | New | Test fixture |
| `desktop/backend/tests/unit/test_hermes_config_reader.py` | New | Unit tests for reader |
| `desktop/backend/tests/integration/test_model_endpoints.py` | Modify | Tests for new endpoint + filter |
| `desktop/src/services/api/transports/http/model.ts` | Modify | Add `getActiveModel()` to interface + impl |
| `desktop/src/services/api/transports/mock/model.ts` | Modify | Mock `getActiveModel()` |
| `desktop/src/stores/models.ts` | Modify | Add `hydrateActiveModel()` + `modelsStore.loadActive()` |
| `desktop/src/modules/model/MainModelCard.tsx` | New | Terracotta-accented active model card |
| `desktop/src/modules/model/MainModelCard.module.css` | New | Card styles |
| `desktop/src/modules/model/ModelPickerModal.tsx` | New | Two-column provider+model picker overlay |
| `desktop/src/modules/model/ModelPickerModal.module.css` | New | Modal styles |
| `desktop/src/modules/model/ModelSwitcherView.tsx` | Modify | Mount both new components; call `loadActive()` on mount |

---

## Task 1 — Backend: `hermes_config.py` reader + unit tests

**Files:**
- Create: `desktop/backend/desktop_backend/readers/hermes_config.py`
- Create: `desktop/backend/tests/fixtures/hermes_home/config.yaml`
- Create: `desktop/backend/tests/unit/test_hermes_config_reader.py`

- [ ] **Step 1: Create fixture `config.yaml`**

```yaml
# desktop/backend/tests/fixtures/hermes_home/config.yaml
model:
  provider: kimi-coding
  default: kimi-k2.6
```

- [ ] **Step 2: Write failing unit tests**

```python
# desktop/backend/tests/unit/test_hermes_config_reader.py
from __future__ import annotations

import textwrap
from pathlib import Path

import pytest

from desktop_backend.readers.hermes_config import read_active_model


def test_reads_provider_and_model(tmp_path: Path):
    (tmp_path / "config.yaml").write_text(
        textwrap.dedent("""\
            model:
              provider: kimi-coding
              default: kimi-k2.6
        """)
    )
    result = read_active_model(tmp_path)
    assert result == {"provider": "kimi-coding", "model": "kimi-k2.6"}


def test_missing_file_returns_nulls(tmp_path: Path):
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_missing_model_key_returns_nulls(tmp_path: Path):
    (tmp_path / "config.yaml").write_text("other_section:\n  foo: bar\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_malformed_yaml_returns_nulls(tmp_path: Path):
    (tmp_path / "config.yaml").write_text(": bad: yaml: :\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": None, "model": None}


def test_partial_model_section(tmp_path: Path):
    (tmp_path / "config.yaml").write_text("model:\n  provider: anthropic\n")
    result = read_active_model(tmp_path)
    assert result == {"provider": "anthropic", "model": None}
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd desktop/backend
python -m pytest tests/unit/test_hermes_config_reader.py -v
```

Expected: `ModuleNotFoundError` for `hermes_config`.

- [ ] **Step 4: Implement the reader**

```python
# desktop/backend/desktop_backend/readers/hermes_config.py
from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def read_active_model(hermes_home: Path) -> dict[str, str | None]:
    config_path = Path(hermes_home) / "config.yaml"
    if not config_path.exists():
        return {"provider": None, "model": None}
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            data: Any = yaml.safe_load(fh)
    except yaml.YAMLError:
        return {"provider": None, "model": None}
    if not isinstance(data, dict):
        return {"provider": None, "model": None}
    section = data.get("model")
    if not isinstance(section, dict):
        return {"provider": None, "model": None}
    return {
        "provider": section.get("provider") or None,
        "model": section.get("default") or None,
    }
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd desktop/backend
python -m pytest tests/unit/test_hermes_config_reader.py -v
```

Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add desktop/backend/desktop_backend/readers/hermes_config.py \
        desktop/backend/tests/fixtures/hermes_home/config.yaml \
        desktop/backend/tests/unit/test_hermes_config_reader.py
git commit -m "feat(backend): add hermes_config reader + unit tests"
```

---

## Task 2 — Backend: `GET /model/active` endpoint

**Files:**
- Modify: `desktop/backend/desktop_backend/routers/model.py`
- Modify: `desktop/backend/tests/integration/test_model_endpoints.py`

Current router (`routers/model.py`) has `GET /model/catalog` and `GET /model/providers`. Add `GET /model/active` between them.

- [ ] **Step 1: Write failing integration tests**

Append to `desktop/backend/tests/integration/test_model_endpoints.py`:

```python
def test_get_active_model_reads_config(client, auth, hermes_home):
    import yaml as _yaml

    (hermes_home / "config.yaml").write_text(
        _yaml.dump({"model": {"provider": "kimi-coding", "default": "kimi-k2.6"}})
    )
    r = client.get("/desktop/api/model/active", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] == "kimi-coding"
    assert body["model"] == "kimi-k2.6"


def test_get_active_model_no_config(client, auth):
    r = client.get("/desktop/api/model/active", headers=auth)
    assert r.status_code == 200
    body = r.json()
    assert body["provider"] is None
    assert body["model"] is None
```

- [ ] **Step 2: Run to confirm fail**

```bash
cd desktop/backend
python -m pytest tests/integration/test_model_endpoints.py::test_get_active_model_reads_config -v
```

Expected: 404 Not Found.

- [ ] **Step 3: Replace `routers/model.py` with the updated version**

```python
# desktop/backend/desktop_backend/routers/model.py
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Query, Request

from ..overlays import loader as overlays_loader
from ..readers import model_catalog
from ..readers.hermes_config import read_active_model
from ..services.merger import merge_providers

router = APIRouter()


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


@router.get("/model/active")
def get_active_model(request: Request):
    cfg = request.app.state.cfg
    return read_active_model(cfg.hermes_home)


@router.get("/model/catalog")
def get_catalog(request: Request):
    cfg = request.app.state.cfg
    catalog = model_catalog.load_catalog(cfg.hermes_home)
    return {
        "providers": catalog["providers"],
        "fetched_at": catalog.get("fetched_at"),
    }


@router.get("/model/providers")
def list_providers(
    request: Request,
    configured_only: bool = Query(default=True),
):
    cfg = request.app.state.cfg
    providers = model_catalog.get_providers(cfg.hermes_home)
    overlay = overlays_loader.load(cfg.hermes_home, "model")
    merged = merge_providers(providers, overlay)
    if configured_only:
        from ..services.merger import filter_configured
        merged = filter_configured(merged)
    return {
        "items": [m.model_dump() for m in merged],
        "generated_at": _now_iso(),
    }
```

Note: this also adds `configured_only` (Task 3's router change) so both tasks share one router edit.

- [ ] **Step 4: Run new tests — expect PASS**

```bash
cd desktop/backend
python -m pytest tests/integration/test_model_endpoints.py -v
```

Expected: existing tests pass; new tests pass (the `configured_only` tests will still fail until Task 3 adds `filter_configured`).

- [ ] **Step 5: Commit**

```bash
git add desktop/backend/desktop_backend/routers/model.py \
        desktop/backend/tests/integration/test_model_endpoints.py
git commit -m "feat(backend): add GET /model/active + configured_only param stub"
```

---

## Task 3 — Backend: `filter_configured` helper + filter tests

**Files:**
- Modify: `desktop/backend/desktop_backend/services/merger.py`
- Modify: `desktop/backend/tests/unit/test_merger.py`
- Modify: `desktop/backend/tests/integration/test_model_endpoints.py`

- [ ] **Step 1: Write failing unit tests**

Append to `desktop/backend/tests/unit/test_merger.py`:

```python
def test_filter_configured_keeps_providers_with_credentials():
    from desktop_backend.services.merger import filter_configured
    from desktop_backend.schemas.model import MergedProvider, ProviderOverlay

    providers = [
        MergedProvider(id="a", name="A", desktop=ProviderOverlay(api_key="sk-123")),
        MergedProvider(id="b", name="B", desktop=ProviderOverlay(api_key_env="MY_KEY")),
        MergedProvider(id="c", name="C", desktop=ProviderOverlay(base_url="http://localhost")),
        MergedProvider(id="d", name="D", desktop=ProviderOverlay()),
        MergedProvider(id="e", name="E", desktop=ProviderOverlay(api_key="")),
    ]
    result = filter_configured(providers)
    assert [p.id for p in result] == ["a", "b", "c"]


def test_filter_configured_empty_list():
    from desktop_backend.services.merger import filter_configured
    assert filter_configured([]) == []
```

- [ ] **Step 2: Write failing integration tests**

Append to `desktop/backend/tests/integration/test_model_endpoints.py`:

```python
def test_providers_configured_only_default(client, auth, hermes_home):
    import json as _json

    od = hermes_home / "desktop" / "overlays"
    od.mkdir(parents=True, exist_ok=True)
    (od / "model.json").write_text(
        _json.dumps({"provider_test_anthropic": {"api_key": "sk-test"}})
    )
    items = client.get("/desktop/api/model/providers", headers=auth).json()["items"]
    ids = [p["id"] for p in items]
    assert "provider_test_anthropic" in ids
    assert "provider_test_openai" not in ids


def test_providers_configured_only_false_shows_all(client, auth):
    items = client.get(
        "/desktop/api/model/providers?configured_only=false", headers=auth
    ).json()["items"]
    assert len(items) == 2
```

- [ ] **Step 3: Run to confirm fail**

```bash
cd desktop/backend
python -m pytest tests/unit/test_merger.py -v -k "filter_configured"
```

Expected: `ImportError` for `filter_configured`.

- [ ] **Step 4: Add `filter_configured` to `merger.py`**

Append to `desktop/backend/desktop_backend/services/merger.py`:

```python
def filter_configured(providers: list[MergedProvider]) -> list[MergedProvider]:
    def _has_creds(p: MergedProvider) -> bool:
        d = p.desktop
        return bool(
            (d.api_key and d.api_key.strip())
            or (d.api_key_env and d.api_key_env.strip())
            or (d.base_url and d.base_url.strip())
        )

    return [p for p in providers if _has_creds(p)]
```

- [ ] **Step 5: Run all backend tests — expect PASS**

```bash
cd desktop/backend
python -m pytest -v
```

Expected: all pass, no regressions.

- [ ] **Step 6: Commit**

```bash
git add desktop/backend/desktop_backend/services/merger.py \
        desktop/backend/tests/unit/test_merger.py \
        desktop/backend/tests/integration/test_model_endpoints.py
git commit -m "feat(backend): add filter_configured + configured_only tests"
```

---

## Task 4 — Frontend: `getActiveModel()` transport + store wiring

**Files:**
- Modify: `desktop/src/services/api/transports/http/model.ts`
- Modify: `desktop/src/services/api/transports/mock/model.ts`
- Modify: `desktop/src/stores/models.ts`

- [ ] **Step 1: Update `ModelTransport` interface and HTTP impl**

Replace `desktop/src/services/api/transports/http/model.ts`:

```typescript
import type { HttpClient } from '../../http-client';
import type { ListResponse, Provider } from '../../types';

export interface ModelTransport {
  listProviders(): Promise<ListResponse<Provider>>;
  getCatalog(): Promise<{ providers: Provider[]; fetched_at: string | null }>;
  getActiveModel(): Promise<{ provider: string | null; model: string | null }>;
}

export function makeModelTransport(c: HttpClient): ModelTransport {
  return {
    listProviders: () =>
      c.get<ListResponse<Provider>>('/desktop/api/model/providers'),
    getCatalog: () =>
      c.get<{ providers: Provider[]; fetched_at: string | null }>(
        '/desktop/api/model/catalog',
      ),
    getActiveModel: () =>
      c.get<{ provider: string | null; model: string | null }>(
        '/desktop/api/model/active',
      ),
  };
}
```

- [ ] **Step 2: Update mock transport**

Replace `desktop/src/services/api/transports/mock/model.ts`:

```typescript
import type { ModelTransport } from '../http/model';
import type { Provider } from '../../types';

const SEED: Provider[] = [
  {
    id: 'provider_test_anthropic',
    name: 'Anthropic',
    auth: 'api_key',
    models: [{ id: 'claude-sonnet-4', context_window: 200000 }],
    desktop: { visible: true },
  },
  {
    id: 'provider_test_openai',
    name: 'OpenAI',
    auth: 'api_key',
    models: [{ id: 'gpt-5', context_window: 128000 }],
    desktop: { visible: true },
  },
];

export function makeMockModelTransport(): ModelTransport {
  return {
    listProviders: async () => ({
      items: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      generated_at: '2026-05-05T09:00:00Z',
    }),
    getCatalog: async () => ({
      providers: SEED.map((p) => ({ ...p, desktop: { ...p.desktop } })),
      fetched_at: '2026-05-05T09:00:00Z',
    }),
    getActiveModel: async () => ({ provider: null, model: null }),
  };
}
```

- [ ] **Step 3: Add `hydrateActiveModel` to `modelStore` in `stores/models.ts`**

After the existing `hydrateProviders` method (line ~61 of `stores/models.ts`), add:

```typescript
  hydrateActiveModel(provider: string | null, model: string | null): void {
    setActiveProvider(provider);
    setActiveModel(model);
  },
```

- [ ] **Step 4: Add `loadActive` to `modelsStore` in `stores/models.ts`**

Inside the `createModelsStore` function body, before the `return` statement, add:

```typescript
  const loadActive = async () => {
    try {
      const active = await api.model().getActiveModel();
      modelStore.hydrateActiveModel(active.provider, active.model);
    } catch {
      modelStore.hydrateActiveModel(null, null);
    }
  };
```

Add `loadActive` to the return value:

```typescript
  return { providers, loading, error, load, loadActive, resolveId };
```

- [ ] **Step 5: Type-check**

```bash
cd desktop
npm run type-check
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/services/api/transports/http/model.ts \
        desktop/src/services/api/transports/mock/model.ts \
        desktop/src/stores/models.ts
git commit -m "feat(frontend): add getActiveModel transport + hydrateActiveModel store"
```

---

## Task 5 — Frontend: `MainModelCard` component

**Files:**
- Create: `desktop/src/modules/model/MainModelCard.tsx`
- Create: `desktop/src/modules/model/MainModelCard.module.css`

Design tokens used: `--color-terracotta` (#c96442), `--color-cream` (#faf9f5), `--color-border`, `--color-on-surface`, `--color-on-surface-muted`, `--color-on-surface-dim`.

- [ ] **Step 1: Create the CSS module**

```css
/* desktop/src/modules/model/MainModelCard.module.css */
.wrapper {
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--color-border);
  margin-bottom: 20px;
  display: flex;
}

.accent {
  width: 3px;
  background: var(--color-terracotta);
  flex-shrink: 0;
}

.body {
  flex: 1;
  background: var(--color-cream);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-on-surface-muted);
  margin-bottom: 4px;
}

.modelLine {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 13px;
  color: var(--color-on-surface);
}

.placeholder {
  font-size: 13px;
  color: var(--color-on-surface-dim);
  font-style: italic;
}

.changeBtn {
  background: rgba(201, 100, 66, 0.08);
  color: var(--color-terracotta);
  border: 1px solid rgba(201, 100, 66, 0.25);
  border-radius: 5px;
  padding: 5px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s;
}

.changeBtn:hover {
  background: rgba(201, 100, 66, 0.15);
}
```

- [ ] **Step 2: Create the component**

```tsx
// desktop/src/modules/model/MainModelCard.tsx
import type { Component } from 'solid-js';
import { Show } from 'solid-js';
import styles from './MainModelCard.module.css';

interface Props {
  provider: string | null;
  model: string | null;
  onChangeClick: () => void;
}

export const MainModelCard: Component<Props> = (props) => {
  const hasModel = () => props.provider !== null || props.model !== null;

  return (
    <div class={styles.wrapper}>
      <div class={styles.accent} />
      <div class={styles.body}>
        <div>
          <div class={styles.label}>Main Model</div>
          <Show
            when={hasModel()}
            fallback={<span class={styles.placeholder}>No model configured</span>}
          >
            <span class={styles.modelLine}>
              {props.provider} · {props.model}
            </span>
          </Show>
        </div>
        <button
          type="button"
          class={styles.changeBtn}
          onClick={props.onChangeClick}
        >
          {hasModel() ? 'Change' : 'Configure'}
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Type-check**

```bash
cd desktop
npm run type-check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/model/MainModelCard.tsx \
        desktop/src/modules/model/MainModelCard.module.css
git commit -m "feat(frontend): add MainModelCard component"
```

---

## Task 6 — Frontend: `ModelPickerModal` component

**Files:**
- Create: `desktop/src/modules/model/ModelPickerModal.tsx`
- Create: `desktop/src/modules/model/ModelPickerModal.module.css`

Two-column modal: 180px provider list | fill model list. Matches `pencil-new.pen` Option C frame `OvLrj`. Reference: `web/src/components/ModelPickerDialog.tsx`.

- [ ] **Step 1: Create the CSS module**

```css
/* desktop/src/modules/model/ModelPickerModal.module.css */
.overlay {
  position: fixed;
  inset: 0;
  background: var(--color-surface-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.modal {
  background: var(--color-surface);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(28, 27, 25, 0.25);
  border: 1px solid var(--color-border);
  width: 600px;
  max-height: 460px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.header {
  padding: 14px 18px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.headerLeft {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.title {
  font-size: 14px;
  font-weight: 600;
  color: var(--color-on-surface);
}

.subtitle {
  font-size: 11px;
  color: var(--color-on-surface-muted);
  font-family: 'IBM Plex Mono', monospace;
}

.closeBtn {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--color-on-surface-muted);
  padding: 2px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  font-size: 14px;
}

.closeBtn:hover {
  color: var(--color-on-surface);
}

.search {
  padding: 10px 14px;
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.searchIcon {
  color: var(--color-on-surface-dim);
  font-size: 13px;
  flex-shrink: 0;
}

.searchInput {
  flex: 1;
  border: none;
  background: none;
  outline: none;
  font-size: 11px;
  color: var(--color-on-surface);
}

.searchInput::placeholder {
  color: var(--color-on-surface-dim);
}

.body {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-height: 0;
}

.provCol {
  width: 180px;
  flex-shrink: 0;
  border-right: 1px solid var(--color-border);
  background: var(--color-background-alt);
  overflow-y: auto;
}

.provRow {
  padding: 10px 14px;
  font-size: 11px;
  cursor: pointer;
  border: none;
  border-left: 2px solid transparent;
  width: 100%;
  text-align: left;
  background: none;
  color: var(--color-on-surface-muted);
  display: block;
}

.provRow:hover {
  background: rgba(201, 100, 66, 0.05);
}

.provRowActive {
  background: rgba(201, 100, 66, 0.06);
  border-left-color: var(--color-terracotta);
  color: var(--color-terracotta);
  font-weight: 500;
}

.modelCol {
  flex: 1;
  background: var(--color-surface);
  overflow-y: auto;
}

.modelRow {
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  border: none;
  width: 100%;
  text-align: left;
  background: none;
  font-size: 11px;
  color: var(--color-on-surface-muted);
}

.modelRow:hover {
  background: var(--color-background-alt);
}

.modelRowSelected {
  background: var(--color-background-alt);
  color: var(--color-on-surface);
  font-weight: 500;
}

.checkIcon {
  color: var(--color-terracotta);
  flex-shrink: 0;
  width: 12px;
  font-size: 11px;
}

.checkPlaceholder {
  width: 12px;
  flex-shrink: 0;
}

.currentBadge {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  background: rgba(201, 100, 66, 0.1);
  color: var(--color-terracotta);
  border-radius: 3px;
  padding: 1px 5px;
}

.footer {
  padding: 12px 18px;
  border-top: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 8px;
}

.footerNote {
  flex: 1;
  font-size: 10px;
  color: var(--color-on-surface-dim);
}

.cancelBtn {
  background: none;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  padding: 7px 14px;
  font-size: 12px;
  cursor: pointer;
  color: var(--color-on-surface-muted);
}

.cancelBtn:hover {
  border-color: var(--color-on-surface-muted);
}

.switchBtn {
  background: var(--color-terracotta);
  color: var(--color-on-primary);
  border: none;
  border-radius: 5px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.switchBtn:hover {
  background: var(--color-primary-hover);
}

.switchBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
```

- [ ] **Step 2: Create the component**

```tsx
// desktop/src/modules/model/ModelPickerModal.tsx
import type { Component } from 'solid-js';
import { createSignal, createMemo, For, Show } from 'solid-js';
import type { ProviderEntry, ModelOption } from '@/types/index.js';
import styles from './ModelPickerModal.module.css';

interface Props {
  open: boolean;
  currentProvider: string | null;
  currentModel: string | null;
  providers: ProviderEntry[];
  onApply: (provider: string, model: string) => void;
  onClose: () => void;
}

export const ModelPickerModal: Component<Props> = (props) => {
  const [searchQuery, setSearchQuery] = createSignal('');
  const [pickedProvider, setPickedProvider] = createSignal<string | null>(null);
  const [pickedModel, setPickedModel] = createSignal<string | null>(null);

  const effectiveProvider = () =>
    pickedProvider() ?? props.currentProvider ?? props.providers[0]?.name ?? null;

  const filteredProviders = createMemo(() => {
    const q = searchQuery().toLowerCase();
    if (!q) return props.providers;
    return props.providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.models ?? []).some((m) => m.name.toLowerCase().includes(q)),
    );
  });

  const selectedEntry = createMemo<ProviderEntry | null>(() => {
    const name = effectiveProvider();
    return filteredProviders().find((p) => p.name === name) ?? filteredProviders()[0] ?? null;
  });

  const models = createMemo<ModelOption[]>(() => selectedEntry()?.models ?? []);

  const effectiveModel = () =>
    pickedModel() ??
    (selectedEntry()?.name === props.currentProvider ? props.currentModel : null);

  const isDirty = () => {
    const ep = effectiveProvider();
    const em = effectiveModel();
    return (
      ep !== null &&
      em !== null &&
      (ep !== props.currentProvider || em !== props.currentModel)
    );
  };

  const handleOverlayClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) props.onClose();
  };

  const handleSwitch = () => {
    const p = effectiveProvider();
    const m = effectiveModel();
    if (p && m) props.onApply(p, m);
  };

  return (
    <Show when={props.open}>
      <div class={styles.overlay} onClick={handleOverlayClick}>
        <div class={styles.modal}>
          <div class={styles.header}>
            <div class={styles.headerLeft}>
              <span class={styles.title}>Set Main Model</span>
              <Show when={props.currentProvider && props.currentModel}>
                <span class={styles.subtitle}>
                  current: {props.currentModel} · {props.currentProvider}
                </span>
              </Show>
            </div>
            <button type="button" class={styles.closeBtn} onClick={props.onClose}>
              ✕
            </button>
          </div>

          <div class={styles.search}>
            <span class={styles.searchIcon}>⌕</span>
            <input
              class={styles.searchInput}
              type="text"
              placeholder="Filter providers and models…"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>

          <div class={styles.body}>
            <div class={styles.provCol}>
              <For each={filteredProviders()}>
                {(provider) => (
                  <button
                    type="button"
                    class={`${styles.provRow} ${effectiveProvider() === provider.name ? styles.provRowActive : ''}`}
                    onClick={() => {
                      setPickedProvider(provider.name);
                      setPickedModel(null);
                    }}
                  >
                    {provider.display_name ?? provider.name}
                  </button>
                )}
              </For>
            </div>

            <div class={styles.modelCol}>
              <For each={models()}>
                {(model) => {
                  const isCurrent = () =>
                    selectedEntry()?.name === props.currentProvider &&
                    model.name === props.currentModel;
                  const isPicked = () => effectiveModel() === model.name;

                  return (
                    <button
                      type="button"
                      class={`${styles.modelRow} ${isPicked() ? styles.modelRowSelected : ''}`}
                      onClick={() => setPickedModel(model.name)}
                    >
                      <Show
                        when={isCurrent()}
                        fallback={<span class={styles.checkPlaceholder} />}
                      >
                        <span class={styles.checkIcon}>✓</span>
                      </Show>
                      {model.display_name ?? model.name}
                      <Show when={isCurrent()}>
                        <span class={styles.currentBadge}>current</span>
                      </Show>
                    </button>
                  );
                }}
              </For>
            </div>
          </div>

          <div class={styles.footer}>
            <span class={styles.footerNote}>Persists to ~/.hermes/config.yaml</span>
            <button type="button" class={styles.cancelBtn} onClick={props.onClose}>
              Cancel
            </button>
            <button
              type="button"
              class={styles.switchBtn}
              disabled={!isDirty()}
              onClick={handleSwitch}
            >
              Switch
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};
```

- [ ] **Step 3: Type-check**

```bash
cd desktop
npm run type-check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/modules/model/ModelPickerModal.tsx \
        desktop/src/modules/model/ModelPickerModal.module.css
git commit -m "feat(frontend): add ModelPickerModal two-column picker component"
```

---

## Task 7 — Frontend: Wire components into `ModelSwitcherView`

**Files:**
- Modify: `desktop/src/modules/model/ModelSwitcherView.tsx`

Current `onMount` (line 32–36) calls `modelStore.loadModels()`, `modelStore.loadActiveModel()`, `modelsStore.load()`. We add `modelsStore.loadActive()` and mount both new components.

- [ ] **Step 1: Add imports**

After the existing import block in `ModelSwitcherView.tsx`, add:

```typescript
import { MainModelCard } from './MainModelCard.js';
import { ModelPickerModal } from './ModelPickerModal.js';
```

- [ ] **Step 2: Add `pickerOpen` signal and update `onMount`**

After the existing `createSignal` declarations (around line 31), add:

```typescript
  const [pickerOpen, setPickerOpen] = createSignal(false);
```

Replace the existing `onMount` block:

```typescript
  onMount(() => {
    modelStore.loadModels();
    modelStore.loadActiveModel();
    void modelsStore.load();
    void modelsStore.loadActive();
  });
```

- [ ] **Step 3: Insert `MainModelCard` as the first child of the hub container**

Inside `<Match when={modelStore.currentView === 'hub'}>`, make `<MainModelCard>` the first element inside `<div class={styles.container}>`:

```tsx
        <div class={styles.container}>
          <MainModelCard
            provider={modelStore.activeProvider}
            model={modelStore.activeModel}
            onChangeClick={() => setPickerOpen(true)}
          />

          <Show when={modelStore.isLoading && modelsStore.providers().length === 0}>
            {/* ... unchanged */}
          </Show>
          {/* ... rest unchanged */}
```

- [ ] **Step 4: Add `ModelPickerModal` before the closing `</Match>`**

Just before `</Match>` (after `<ConfigureProviderModal ...>`), add:

```tsx
          <ModelPickerModal
            open={pickerOpen()}
            currentProvider={modelStore.activeProvider}
            currentModel={modelStore.activeModel}
            providers={modelsStore.providers()}
            onApply={async (provider, model) => {
              await modelStore.switchModel(provider, model);
              setPickerOpen(false);
            }}
            onClose={() => setPickerOpen(false)}
          />
```

- [ ] **Step 5: Type-check**

```bash
cd desktop
npm run type-check
```

Expected: no errors.

- [ ] **Step 6: Run unit tests**

```bash
cd desktop
npm run test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/model/ModelSwitcherView.tsx
git commit -m "feat(frontend): wire MainModelCard + ModelPickerModal into ModelSwitcherView"
```

---

## Task 8 — Acceptance verification

- [ ] **Step 1: Run full backend test suite**

```bash
cd desktop/backend
python -m pytest -v
```

Expected: all pass. Grep check — no upstream imports:

```bash
grep -r "from hermes_cli\|from cron\|from tui_gateway\|from web\|from agent" \
  desktop/backend/desktop_backend/ && echo "VIOLATION" || echo "OK"
```

Expected: `OK`.

- [ ] **Step 2: Run frontend type-check and tests**

```bash
cd desktop
npm run type-check && npm run test
```

Expected: no type errors, all unit tests pass.

- [ ] **Step 3: Start dev server and manually verify**

```bash
cd desktop
npm run dev
```

Open `http://localhost:1420`, navigate to Model page. Check:
1. Provider list shows only configured providers (those with credentials).
2. Main Model card is visible above the tabs row.
3. Clicking "Change" opens the picker modal.
4. Selecting a different model and clicking "Switch" closes the modal and updates the card.
5. When no model is configured the card shows "No model configured" with a "Configure" button.
