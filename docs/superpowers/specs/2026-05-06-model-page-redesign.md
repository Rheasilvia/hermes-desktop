# Model Page Redesign — Design Spec

**Date:** 2026-05-06
**Branch:** `feat/desktop-standalone`
**Status:** Approved for implementation

---

## Problem

The desktop Model page has two defects:

1. **Wrong providers displayed.** `GET /model/providers` sources from
   `~/.hermes/cache/model_catalog.json`, which contains every provider in the
   upstream catalog (Anthropic, OpenAI, DeepSeek, …). Users who ran `hermes
   setup` to configure only kimi-coding and minimax see dozens of unconfigured
   providers cluttering the UI.

2. **No "Main Model" concept.** The web dashboard has a `ModelSettingsPanel`
   that shows the active model at a glance. The desktop has no equivalent, so
   users cannot see which model is active without scrolling and scanning.

---

## Design Reference

Pencil mockup: `pencil-new.pen` (Option C layout, approved 2026-05-06).

Key visual decisions:
- **Main Model card** sits between the page header and the Providers/Models
  tabs — always visible regardless of which tab is active.
- Card uses a 3 px terracotta (`#c96442`) left accent (outer wrapper
  technique), "MAIN MODEL" label in small-caps, `provider · model` in IBM Plex
  Mono, and a "Change" button in terracotta tint.
- Provider grid shows only configured providers; each card has a colored dot
  (terracotta = active provider, stone = inactive) and an "active" badge on the
  currently selected provider.

---

## Architecture

### Backend — two changes to `desktop_backend`

#### 1. New reader: `readers/hermes_config.py`

Reads `~/.hermes/config.yaml` using PyYAML (already a transitive dep).
Extracts only the `model` section:

```python
# Returns e.g. {"provider": "kimi-coding", "default": "kimi-k2.6"}
def read_active_model(hermes_home: Path) -> dict[str, str | None]
```

No full config parsing — only the `model` key is needed. Falls back to
`{"provider": None, "default": None}` if the file is missing or malformed.

**Constraint:** no upstream imports (`hermes_cli`, `cron`, etc.).

#### 2. New endpoint: `GET /model/active`

```
Response: { "provider": str | null, "model": str | null }
```

Reads `hermes_config.read_active_model()`. O(1), no catalog I/O.

#### 3. Filter `GET /model/providers` to configured-only

A provider is "configured" when its L2 overlay entry has at least one
credential field set (`api_key`, `api_key_env`, or `base_url` is non-null
and non-empty).

Add a `configured_only: bool = True` query param to `GET /model/providers`.
When `true` (the default), the merged list is post-filtered to only entries
matching the above predicate. `GET /model/catalog` is unchanged.

No new endpoint needed — the existing `/model/providers` gains a filter.

### Frontend — three changes

#### 1. `ModelTransport` — new `getActiveModel()` method

```typescript
// src/services/api/transports/http/model.ts
getActiveModel(): Promise<{ provider: string | null; model: string | null }>
```

Calls `GET /desktop/api/model/active`. Added to the `ModelTransport` interface
and `makeModelTransport` factory. Mock transport returns
`{ provider: null, model: null }`.

#### 2. `modelsStore.load()` — uses filtered endpoint by default

`listProviders()` already calls `/model/providers`. Since the backend now
defaults `configured_only=true`, no URL change is needed. The store works
as-is once the backend is updated.

#### 3. New component: `MainModelCard.tsx`

Location: `src/modules/model/MainModelCard.tsx` + `MainModelCard.module.css`

Props:
```typescript
interface Props {
  provider: string | null;
  model: string | null;
  onChangeClick: () => void;
}
```

Renders the terracotta-accented card. When both props are null, shows a
"No model configured" placeholder with a "Configure" button.

**Wiring in `ModelSwitcherView.tsx`:**
- On mount, call `api.model().getActiveModel()` to populate
  `modelStore.activeProvider` and `modelStore.activeModel`.
- Render `<MainModelCard>` as the first element inside the hub `<Match>` block,
  above the tabs row.
- "Change" button calls `modelStore.openProviderDetail(activeProvider)` if a
  provider is set, otherwise `modelStore.navigateTo('hub')`.

### State flow

```
Mount → api.model().getActiveModel() → modelStore.{activeProvider, activeModel}
      → modelsStore.load()           → modelsStore.providers() (filtered list)

MainModelCard reads: modelStore.activeProvider, modelStore.activeModel
ProviderCard reads:  modelsStore.providers(), modelStore.activeProvider
```

---

## Error handling

| Scenario | Behaviour |
|---|---|
| `config.yaml` missing | `/model/active` returns `{provider: null, model: null}`; card shows placeholder |
| Overlay has no configured providers | `/model/providers` returns `[]`; existing `EmptyProviders` component shown |
| Sidecar down | Existing error state in `modelsStore`; card renders with null props |

---

## Files changed

| File | Change |
|---|---|
| `desktop/backend/desktop_backend/readers/hermes_config.py` | New — reads config.yaml model section |
| `desktop/backend/desktop_backend/routers/model.py` | Add `GET /model/active`; add `configured_only` filter |
| `desktop/backend/desktop_backend/services/merger.py` | Add `filter_configured()` helper |
| `desktop/backend/tests/unit/test_hermes_config_reader.py` | New unit tests |
| `desktop/backend/tests/integration/test_model_endpoints.py` | Tests for new endpoint + filter |
| `desktop/src/services/api/transports/http/model.ts` | Add `getActiveModel()` |
| `desktop/src/services/api/transports/mock/model.ts` | Mock `getActiveModel()` |
| `desktop/src/services/api/router.ts` | Wire `getActiveModel()` through router |
| `desktop/src/modules/model/MainModelCard.tsx` | New component |
| `desktop/src/modules/model/MainModelCard.module.css` | New styles |
| `desktop/src/modules/model/ModelSwitcherView.tsx` | Mount `MainModelCard`; load active model on mount |

---

## Acceptance criteria

1. Running the desktop app with kimi-coding + minimax configured shows exactly
   those two providers — no unconfigured catalog providers appear.
2. The Main Model card displays the active model (e.g. "kimi-coding · kimi-k2.6")
   immediately on page load.
3. Clicking "Change" navigates to the provider/model selection view.
4. When no model is configured, the card shows a "No model configured"
   placeholder state.
5. All existing unit and integration tests pass; new tests cover the reader,
   the filter, and the new endpoint.
6. No imports from `hermes_cli` or other upstream packages anywhere in
   `desktop_backend/`.
