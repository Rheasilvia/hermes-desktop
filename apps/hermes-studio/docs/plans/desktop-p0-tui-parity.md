# Desktop P0 TUI Parity — Architecture Validation & Implementation Plan

> **Status**: Architecture validation & protocol reconnaissance complete  
> **Scope**: Restore deleted settings tabs, implement Inline Todo Panel, implement Subagent/Delegation Tree Viewer  
> **Design Authority**: `@desktop/DESIGN.md` (Claude-inspired warm editorial system)

---

## 1. Executive Summary

This document records the findings from the architecture validation and protocol reconnaissance phase for bringing three P0 TUI features into the Desktop application. The backend protocol is already complete — the gaps are entirely on the Desktop frontend consumption layer. The CSS design system is fully compatible with the deleted code. One component extension is required (`ConfigField` dynamic list support).

**Key finding**: The `todos` payload is not emitted as a standalone SSE event; it is attached to the existing `tool.complete` event. No new Gateway event types are required for Todo Panel — only a field addition to the existing `ToolCompletePayload` mapping.

---

## 2. Architecture Validation

### 2.1 ConfigField Component Analysis

**Current `ConfigField` API** (`desktop/src/features/settings/ConfigField.tsx`):

```ts
type: 'text' | 'number' | 'select' | 'toggle' | 'slider'
```

**Compatibility matrix for restored settings tabs**:

| Tab | Field Types Used | Supported? |
|-----|-----------------|------------|
| AgentTab | `number`, `toggle`, `select` | ✅ Yes |
| BrowserTab | `select`, `number` | ✅ Yes |
| MemoryTab | `toggle`, `number` | ✅ Yes |
| VoiceTab | `toggle`, `number`, `select` | ✅ Yes |
| YamlTab | `text` | ✅ Yes |
| **SecurityTab** | `toggle` + **dynamic string list** (dangerous commands) | ⚠️ **No** |

**Action required**: Extend `ConfigField` with a `type: 'list'` variant, or implement a custom list control inside `SecurityTab` using the same atoms (`Input`, `Button`, `Pill`).

### 2.2 CSS / Style System Compatibility

The deleted settings tabs used CSS custom properties that are **identical** to the current design token system:

- `var(--space-5)`, `var(--space-12)`
- `var(--color-surface)`, `var(--color-on-surface-muted)`, `var(--color-border-light)`, `var(--color-primary)`
- `var(--font-sans)`, `var(--font-serif)`
- `var(--radius-md)`, `var(--text-sm)`, `var(--text-lg)`

**Conclusion**: CSS module files can be restored from git history without modification.

---

## 3. Protocol Reconnaissance

### 3.1 Todo Events

**Discovery** (`tui_gateway/server.py:1770–1774`):

There is **no standalone `todo` SSE event**. The `todos` array is attached to `tool.complete` when the tool name equals `"todo"`:

```python
if name == "todo":
    data = json.loads(result)
    if isinstance(data, dict) and isinstance(data.get("todos"), list):
        payload["todos"] = data.get("todos")
```

**Current Desktop mapping** (`desktop/src/services/gateway/http-adapter.ts:596–602`):

```ts
case 'tool.complete':
  this.emit('tool.complete', {
    tool_id: String(payload.tool_id ?? ''),
    name: String(payload.name ?? ''),
    summary: String(payload.summary ?? ''),
    duration_s: Number(payload.duration_s ?? 0),
    // ❌ todos is dropped
  });
```

**Required change**: Add `todos?: TodoItem[]` to `ToolCompletePayload` and forward it through `dispatchSseEvent`.

### 3.2 Subagent Events

**Discovery** (`tui_gateway/server.py:1816–1873`):

The backend emits a full family of `subagent.*` SSE events:

| Event | Key Payload Fields |
|-------|-------------------|
| `subagent.start` | `subagent_id`, `parent_id`, `depth`, `model`, `goal`, `task_count`, `task_index` |
| `subagent.progress` | `subagent_id`, `status`, `tool_count`, `toolsets` |
| `subagent.complete` | `subagent_id`, `summary`, `duration_seconds`, `cost_usd`, `input_tokens`, `output_tokens`, `reasoning_tokens`, `api_calls`, `files_read`, `files_written` |
| `subagent.tool` | `subagent_id`, `tool_name`, `tool_preview`, `text` |
| `subagent.error` | `subagent_id`, `status`, `text` |

**RPC methods available** (`tui_gateway/server.py:3546–3588`):

- `delegation.status` → `{ active: [...], paused: bool, max_spawn_depth: int }`
- `delegation.pause` → `{ paused: bool }`
- `subagent.interrupt` → `{ found: bool, subagent_id: string }`

**Current Desktop state**: `http-adapter.ts` has **zero** handling for `subagent.*` events and no `delegation` or `subagent` RPC method groups.

**Required change**: Full protocol extension — new payload types, `GatewayEventMap` entries, SSE dispatch cases, and RPC method groups.

---

## 4. Design System Compliance

All new UI components must follow `@desktop/DESIGN.md`. Below are the concrete design rules for each new surface.

### 4.1 TodoPanel

A collapsible inline panel embedded within the message stream.

| Property | Value | Design System Reference |
|----------|-------|------------------------|
| Background | `Ivory (#faf9f5)` | Card Surface |
| Border | `1px solid Border Cream (#f0eee6)` | Contained (Level 1) |
| Border Radius | `8px` | Comfortably rounded |
| Title Font | `Anthropic Sans`, `15px`, weight `500` | Body Small |
| Todo Item Font | `Anthropic Sans`, `15px`, weight `400` | Body Small |
| Title Color | `Anthropic Near Black (#141413)` | Primary Text |
| Count Label | `Stone Gray (#87867f)` | Tertiary Text |
| Active Status | `Terracotta Brand (#c96442)` | Brand accent |
| Completed/Cancelled | `Stone Gray (#87867f)` | Dimmed state |
| Hover State | `Ring Warm (#d1cfc5) 0px 0px 0px 1px` | Ring (Level 2) |
| Padding | `12px 16px` | Generous internal padding |
| Collapse Toggle | `▾ / ▸` glyph in `Olive Gray (#5e5d59)` | Secondary text |

**Status glyphs** (replacing TUI's bracket notation with a warmer visual language):

| Status | Glyph | Color |
|--------|-------|-------|
| `pending` | `○` open circle | `Stone Gray (#87867f)` |
| `in_progress` | `◐` half-fill | `Terracotta Brand (#c96442)` |
| `completed` | `●` filled circle | `Olive Gray (#5e5d59)` |
| `cancelled` | `⊘` crossed circle | `Stone Gray (#87867f)` |

### 4.2 Subagent Tree Viewer (Side Panel)

**UI container**: Side Panel, integrated into the existing `sidePanelStore` system alongside Workspace and Git Diff. This reuses the established drag-resize behavior and tab-switching chrome.

| Property | Value | Design System Reference |
|----------|-------|------------------------|
| Panel Background | `Ivory (#faf9f5)` | Card Surface |
| Panel Border Left | `1px solid Border Warm (#e8e6dc)` | Prominent border |
| Header Background | `Parchment (#f5f4ed)` | Page background |
| Header Title | `Anthropic Serif`, `20.8px`, weight `500` | Feature Title |
| Header Subtitle | `Anthropic Sans`, `14px`, weight `400` | Caption |
| Row Text | `Anthropic Sans`, `15px`, weight `400` | Body Small |
| Row Metadata | `Anthropic Sans`, `14px`, weight `400` | Caption |
| Status Badge | `Pill` atom with warm background | Atom component |
| Sparkline Color | `Terracotta Brand (#c96442)` | Brand accent |
| Sort/Filter Controls | `Warm Sand (#e8e6dc)` buttons | Secondary button |
| Active Sort Button | `Dark Surface (#30302e)` with `Ivory` text | Dark Charcoal variant |
| Empty State | `Stone Gray (#87867f)` centered text | Tertiary text |

**Tree indentation visual**: Use a warm vertical guide line (`1px solid Border Cream #f0eee6`) rather than cold gray lines. Each depth level indents by `24px`.

### 4.3 Settings Tabs (Restored)

The restored tab buttons and section titles must align with the current design system:

- **Tab labels**: `Anthropic Sans`, `15px`, weight `500`, color `Olive Gray (#5e5d59)`
- **Active tab**: `Anthropic Near Black (#141413)` text with a `Terracotta Brand (#c96442)` bottom border indicator (`2px solid`)
- **Section titles**: `Anthropic Serif`, `25.6px`, weight `500`, color `Anthropic Near Black (#141413)`
- **Section cards**: `Ivory (#faf9f5)` background, `Border Cream (#f0eee6)` border, `8px` radius
- **ConfigField labels**: `Anthropic Sans`, `15px`, weight `500`, color `Charcoal Warm (#4d4c48)`
- **ConfigField descriptions**: `Anthropic Sans`, `14px`, weight `400`, color `Stone Gray (#87867f)`

---

## 5. Implementation Plan

### Phase 1: Settings Tabs Restoration
**Duration**: 1–2 days  
**Dependencies**: None (independent deliverable)

1. **Restore files from git history** (`8d01ec912^`):
   ```bash
   git show 8d01ec912^:desktop/src/features/settings/tabs/AgentTab.tsx > desktop/src/features/settings/tabs/AgentTab.tsx
   # Repeat for BrowserTab, MemoryTab, SecurityTab, VoiceTab, YamlTab + .module.css
   ```
2. **Restore `SettingsView.tsx` tab routing** — re-enable all tabs by removing `disabled: true`.
3. **Extend `ConfigField`** with `type: 'list'` (or implement custom list UI in `SecurityTab`):
   - Input field + "Add" button in `Warm Sand`
   - Added items rendered as `Pill` atoms with remove action
4. **Verify** load/save round-trips through `settingsStore`.

### Phase 2: Todo Panel
**Duration**: 3–5 days  
**Dependencies**: None (only touches existing `tool.complete` mapping)

1. **Extend `ToolCompletePayload`** (`desktop/src/types/gateway.ts`):
   ```ts
   export interface ToolCompletePayload {
     tool_id: string;
     name: string;
     summary?: string;
     inline_diff?: string;
     duration_s?: number;
     todos?: TodoItem[]; // ← added
   }
   ```
2. **Forward `todos` in `http-adapter.ts`**:
   - `dispatchSseEvent` (`case 'tool.complete'`): include `todos` in emitted payload
   - `aggregateEventRows` (`case 'tool.complete'`): persist `todos` into the message object
3. **Add `TodoItem` type** to `desktop/src/types/index.ts`.
4. **Create `TodoPanel.tsx`** component following §4.1 design rules.
5. **Integrate into message rendering**:
   - Render `TodoPanel` inside `AssistantMessage` when `todos` are present
   - Position: between `TurnActivityPanel` and the first `tool_group`

### Phase 3: Subagent Tree Viewer
**Duration**: 1.5–2 weeks  
**Dependencies**: Phase 2's Gateway extension patterns (for reference)

1. **Extend Gateway protocol**:
   - Add payload types: `SubagentStartPayload`, `SubagentProgressPayload`, `SubagentCompletePayload`, `SubagentToolPayload`, `SubagentErrorPayload`
   - Register events in `GatewayEventMap`
   - Add RPC interfaces: `DelegationMethods`, `SubagentMethods`
2. **Implement SSE dispatch** in `http-adapter.ts` for all `subagent.*` cases.
3. **Implement RPC methods** in `http-adapter.ts`.
4. **Port `subagentTree.ts` logic** from TUI (`ui-tui/src/lib/subagentTree.ts`) to `desktop/src/lib/subagentTree.ts`.
5. **Create `delegationStore.ts`**:
   - Session-scoped subagent state
   - Sort modes: `spawn-order` | `slowest` | `status` | `busiest`
   - Filter modes: `all` | `running` | `failed` | `leaves`
6. **Create `DelegationSidePanel.tsx`** following §4.2 design rules:
   - Registered in `sidePanelStore` as a new tab
   - Entry button in `ChatToolbar`
   - Tree/list view with warm vertical guide lines
   - Sort/filter bar using `Warm Sand` buttons
   - Interrupt action per subagent row
   - Pause/resume delegation toggle in header
7. **Wire events** in `ChatView.tsx`.

---

## 6. Revised Architecture Decisions

| Original Plan Assumption | Validated Reality | Decision |
|-------------------------|-------------------|----------|
| Need new `todo.update` SSE event | `todos` is a field on `tool.complete` | **Simplify**: extend existing payload type only |
| Gateway protocol is missing | Protocol is complete; Desktop frontend is missing consumption | **Simplify**: frontend-only work for most features |
| CSS files need migration | Token names are identical | **Restore directly** from git history |
| Subagent Tree as Modal/Overlay | Side Panel infrastructure already exists | **Use Side Panel** — reuses drag/resize, tab management, and fits the design system's editorial pacing |
| Todo state in `chatStore` | Todo is turn-scoped, Subagent is session-scoped | **Split**: Todo lives in `LiveTurnState` (chatStore); Subagent lives in `delegationStore` |

---

## 7. Risk Assessment & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `ConfigField` `type: 'list'` extension breaks existing fields | Low | Medium | Add as a new branch in the component; existing types unchanged |
| Restored settings tabs use deprecated component APIs | Medium | Low | Validate each tab in Storybook or manual test before merge |
| `tool.complete` payload size increase with `todos` | Low | Low | `todos` is only present for `name === "todo"`; negligible overhead |
| Subagent SSE events not reaching HTTP adapter | Medium | High | Verify in backend logs that `subagent.*` events are emitted over SSE; if missing, the gap is in `tui_gateway` HTTP transport layer, not Desktop |
| Side Panel layout conflicts with Workspace/Git | Low | Medium | Use `sidePanelStore` active-tab switching; only one panel visible at a time |
| Sparkline visualization in Subagent Tree is complex | Medium | Medium | Defer sparkline to Phase 3.1; ship list view first |
| Message block parser doesn't support `todo_list` block type | High | High | Add parser rule in `aggregateEventRows` + `parseMessageBlocks()` before UI work |
| `createStore` subagent state causes re-render storms | Medium | Medium | Use `reconcile` or granular path updates; never replace full object |
| Hand-rolled tree keyboard navigation is buggy | Medium | Medium | Use `role="tree"` + roving tabindex; test with screen readers |
| Settings sidebar nav not in deleted code | High | Medium | Design from scratch using existing `Button` + `Icon` atoms |
| Restored settings tabs use deprecated component APIs | Medium | Low | Validate each tab manually before merge |

---

## 8. Appendix: Quick Reference for Implementers

### TodoItem Type
```ts
export interface TodoItem {
  id: string;
  content: string;
  status: 'cancelled' | 'completed' | 'in_progress' | 'pending';
}
```

### Subagent Event Payloads (Minimal)
```ts
export interface SubagentStartPayload {
  subagent_id: string;
  goal: string;
  parent_id?: string;
  model?: string;
  depth?: number;
}

export interface SubagentCompletePayload {
  subagent_id: string;
  summary?: string;
  duration_seconds?: number;
  cost_usd?: number;
  input_tokens?: number;
  output_tokens?: number;
}
```

### Design Token Cheat Sheet
- Page bg: `#f5f4ed` (Parchment)
- Card bg: `#faf9f5` (Ivory)
- Primary text: `#141413` (Near Black)
- Secondary text: `#5e5d59` (Olive Gray)
- Tertiary text: `#87867f` (Stone Gray)
- Border light: `#f0eee6` (Border Cream)
- Border prominent: `#e8e6dc` (Border Warm)
- Brand accent: `#c96442` (Terracotta)
- Button secondary bg: `#e8e6dc` (Warm Sand)
- Focus ring: `#3898ec` (Focus Blue) — the only cool color, for accessibility only

---

## 9. Frontend Component Architecture

> This section addresses the component decomposition, state architecture, and data-modeling gaps identified during frontend design review. The backend protocol is complete; all remaining work is on the Desktop consumption layer.

### 9.1 Component Decomposition

The original plan described three monolithic organisms (`TodoPanel`, `DelegationSidePanel`, restored settings tabs). Frontend review identified that this under-decomposes the UI into reusable atoms and molecules. The following decomposition is required:

#### 9.1.1 New Atoms

| Atom | Purpose | Consumers |
|------|---------|-----------|
| `Disclosure` | Generic expand/collapse container with header + content | `TodoPanel`, `SubagentTreeNode`, future refactor of `TurnActivityPanel` and `ToolCallPanel` |
| `StringListField` | Input + add button + removable `Pill` items for dynamic string arrays | `SecurityTab` (dangerous commands list) |
| `TodoStatusGlyph` | Pure presentational status glyph (`○ ◐ ● ⊘`) with warm color mapping | `TodoItemRow` |
| `TreeView<T>` | Generic tree container with warm vertical guide lines, depth indentation, expand/collapse | `SubagentTree`, generalized `ToolCallTree` |

**Why not extend `ConfigField` with `type: 'list'`?**

`ConfigField` is already a "smart" branching component for scalar values (`text`, `number`, `toggle`, `select`, `slider`). Adding list logic bloats it and invites a combinatorial explosion when the next tab needs `type: 'key_value'` or `type: 'json'`. A standalone `StringListField` atom keeps `ConfigField` focused and `SecurityTab` directly composes the atom it needs.

#### 9.1.2 New Molecules

| Molecule | Responsibility |
|----------|---------------|
| `TodoItemRow` | Single todo row: status glyph + content text + optional status badge. Pure presentational. |
| `TodoList` | List container: renders `TodoItemRow[]`, handles empty state, sorting (if needed). |
| `SubagentTreeNode` | Single tree row: goal text, depth indentation via warm vertical guide, status badge, metrics caption, interrupt action. |
| `SubagentSortFilterBar` | Warm Sand button row for sort modes (`spawn-order`, `slowest`, `status`, `busiest`) and filter modes (`all`, `running`, `failed`, `leaves`). |
| `SubagentMetricsRow` | Tokens, cost, duration metadata rendered in Caption style (`14px`, `Stone Gray`). |
| `SettingsNavItem` | Sidebar navigation item: icon + label + active indicator (Terracotta bottom border). |
| `SettingsLayout` | Two-column template: `SettingsNavItem[]` sidebar + scrollable content area. |

#### 9.1.3 New Organisms

| Organism | Composition |
|----------|-------------|
| `TodoPanel` | `Disclosure` (header: title + count + ▸/▾) + `TodoList` |
| `SubagentTree` | `TreeView<SubagentRecord>` + `SubagentTreeNode` per node |
| `DelegationSidePanel` | Header (title + pause toggle) + `SubagentSortFilterBar` + `SubagentTree` |

#### 9.1.4 Settings Tabs Are Not a "Restore"

Current `SettingsView.tsx` **does not have tab navigation** — it only renders `GeneralTab`. The deleted settings tabs had content components, but the navigation chrome was either never built or was also deleted. The plan must design a `SettingsLayout` with a vertical sidebar from scratch using existing `Button` and `Icon` atoms.

**Recommended layout:**
```
┌─────────────────────────────────────────────┐
│  Settings          │  [GeneralTab content]  │
│  ────────────────  │                        │
│  ○ General         │                        │
│  ● Agent     ←── active                     │
│  ○ Browser         │                        │
│  ○ Memory          │                        │
│  ○ Security        │                        │
│  ○ Voice           │                        │
│  ○ YAML            │                        │
└─────────────────────────────────────────────┘
```

### 9.2 State Architecture Design

#### 9.2.1 Todo State — Turn-Scoped

Todos arrive on `tool.complete` during an active turn. They must accumulate in the ephemeral `LiveTurnState` and then be persisted into the finalized `RenderedMessage`.

**Critical decision: Where do todos live in the message block model?**

`AssistantMessage.tsx` iterates `blocks: MessageBlock[]`. Three approaches were evaluated:

| Approach | Verdict |
|----------|---------|
| **A. New `todo_list` block type** | ✅ **Chosen**. Clean separation, explicit parser support, native block-switch rendering. |
| **B. Attach to `ToolCallBlock`** | Rejected. Todos are semantically not tool calls; tight coupling. |
| **C. Rich content block** | Rejected. Loses structured data; hard to re-render deterministically. |

**Required type extensions:**

```ts
// desktop/src/types/ui/blocks.ts
export interface TodoListBlock {
  type: 'todo_list';
  toolId: string;      // which tool call produced these todos
  todos: TodoItem[];
}

export type MessageBlock =
  | TextBlock
  | CodeBlock
  | ToolCallBlock
  | AttachmentBlock
  | RichContentBlock
  | TodoListBlock;  // ← NEW
```

```ts
// desktop/src/types/ui/turn.ts
interface LiveTurnState {
  // ... existing fields (streamingText, reasoningText, activeTools, etc.)
  todos: TodoItem[];  // ← NEW: accumulated during the turn
}
```

**Parser logic:** In `aggregateEventRows`, when processing `tool.complete` with `todos`, emit a `TodoListBlock` (or attach it to the adjacent `ToolCallBlock`'s block sequence). In `AssistantMessage`, add a `case 'todo_list'` to the block renderer.

#### 9.2.2 Subagent State — Session-Scoped

Subagent state outlives a single turn. It lives in a dedicated `delegationStore` using SolidJS `createStore` for granular reactivity.

**Storage shape (normalized, flat):**

```ts
// desktop/src/stores/delegation.ts
interface SubagentRecord {
  subagent_id: string;
  parent_id?: string;
  depth: number;
  model?: string;
  goal: string;
  status: 'running' | 'complete' | 'error' | 'paused';
  task_count?: number;
  task_index?: number;
  tool_count?: number;
  toolsets?: string[];
  input_tokens?: number;
  output_tokens?: number;
  reasoning_tokens?: number;
  api_calls?: number;
  cost_usd?: number;
  files_read?: number;
  files_written?: number;
  output_tail?: string;
  summary?: string;
  duration_seconds?: number;
  tool_preview?: string;
  error_text?: string;
}

const [subagentMap, setSubagentMap] = createStore<Record<string, SubagentRecord>>({});
```

**Event → state reducer logic:**

| Event | Reducer Action |
|-------|---------------|
| `subagent.start` | `setSubagentMap(id, { ...defaults, ...payload, status: 'running' })` |
| `subagent.progress` | Patch `status`, `tool_count`, `toolsets` by `subagent_id` |
| `subagent.tool` | Append tool preview to the subagent's `tool_preview` or internal tool log |
| `subagent.complete` | Patch `status: 'complete'`, add `summary`, `duration_seconds`, metrics |
| `subagent.error` | Patch `status: 'error'`, add `error_text` |
| `delegation.pause` | Set global `paused: boolean` flag on store |

**Computed signals (derived, read-only):**

```ts
const subagentList = createMemo(() => Object.values(subagentMap));

const filteredSubagents = createMemo(() => {
  let list = subagentList();
  // filter mode: 'all' | 'running' | 'failed' | 'leaves'
  // sort mode: 'spawn-order' | 'slowest' | 'status' | 'busiest'
  return list;
});

const subagentTree = createMemo(() => {
  // Build nested tree from flat `parent_id` references
  // Return root nodes only; children accessed recursively
});
```

**Important:** Use granular `setSubagentMap` path updates (e.g., `setSubagentMap(id, 'status', 'complete')`) rather than replacing the whole record. This prevents re-render storms in the tree.

#### 9.2.3 Side Panel Store Extension

`sidePanelStore` currently has `activeTab: 'workspace' | 'git'`. Adding `'delegation'` requires:

1. Extend the tab union: `type SidePanelTab = 'workspace' | 'git' | 'delegation'`
2. Add the tab button in the side panel chrome (currently hand-rolled in `WorkspaceSidePanel.tsx`)
3. Add the `<Match when={activeTab() === 'delegation'}>` case
4. Wire the entry button in `ChatToolbar`

### 9.3 Data Model Extensions

The following type files must be extended. This is a checklist for implementers:

- [ ] `desktop/src/types/gateway.ts` — Add `todos?: TodoItem[]` to `ToolCompletePayload`
- [ ] `desktop/src/types/gateway.ts` — Add `SubagentStartPayload`, `SubagentProgressPayload`, `SubagentCompletePayload`, `SubagentToolPayload`, `SubagentErrorPayload`
- [ ] `desktop/src/types/gateway.ts` — Add `SubagentEventMap` entries (or extend `GatewayEventMap`)
- [ ] `desktop/src/types/ui/blocks.ts` — Add `TodoListBlock` to `MessageBlock` union
- [ ] `desktop/src/types/ui/turn.ts` — Add `todos: TodoItem[]` to `LiveTurnState`
- [ ] `desktop/src/services/gateway/types.ts` — Extend `GatewayEventMap` with `subagent.*` events
- [ ] `desktop/src/services/gateway/http-adapter.ts` — Forward `todos` in `dispatchSseEvent` + `aggregateEventRows`
- [ ] `desktop/src/services/gateway/http-adapter.ts` — Add `subagent.*` dispatch cases
- [ ] `desktop/src/services/gateway/http-adapter.ts` — Add `delegation.*` + `subagent.*` RPC method groups

### 9.4 Reuse Opportunities

The following existing patterns should be leveraged rather than rebuilt:

| Existing Pattern | Reuse For |
|-----------------|-----------|
| `TurnActivityPanel` 3-state machine (active → collapsed pill → expanded) | `TodoPanel` inline lifecycle |
| `ToolCallTree` indentation + expand/collapse | Generalize to `TreeView<T>` for `SubagentTree` |
| `Badge` atom (`status` prop) | `SubagentStatusBadge` — map subagent statuses to Badge variants |
| `sidePanelStore` + drag-resize RAF pattern | `DelegationSidePanel` container |
| `Pill` atom (`onRemove` callback) | `StringListField` item chips |
| `ChatStore` flush pattern (live state → finalized message) | Todo accumulation in `LiveTurnState` |

---

## 10. Animation & Accessibility

### 10.1 Motion Design

The plan specified static styling but omitted motion design, which is critical for these interactive features. All animations use CSS transitions (SolidJS does not use Framer Motion).

| Feature | Animation Spec |
|---------|---------------|
| **Disclosure expand/collapse** | `height: 0 → auto` via CSS grid trick or `max-height` transition; `opacity: 0 → 1`; duration `200ms ease-out` |
| **TodoPanel collapse/expand** | Same as Disclosure; chevron rotates `0deg → 90deg` with `transform 200ms ease` |
| **Todo status change** | Color transition `200ms ease` on glyph; `transform: scale(1.1)` pulse on status change, then settle |
| **Subagent tree node expand** | Children stagger in with `opacity 0 → 1` + `translateY(-4px → 0)`; delay `i * 40ms` per child |
| **New subagent spawn** | Slide in from top: `translateY(-8px → 0)` + `opacity 0 → 1`; warm border flash (`#c96442` ring for 400ms) |
| **Subagent completion** | Metrics fade in; optional counting-up animation deferred to Phase 3.1 |
| **Settings tab switch** | Content cross-fade `opacity 150ms ease` |
| **Sort/filter button active** | Background color transition `150ms ease`; text color transition `150ms ease` |

**Implementation note:** Use SolidJS `classList` or conditional CSS classes to trigger transitions. Avoid JS-driven animation libraries.

### 10.2 Accessibility Requirements

| Component | a11y Spec |
|-----------|-----------|
| **TodoPanel** | `role="list"` on container; each item `role="listitem"`; status changes use `aria-live="polite"` on a visually hidden region |
| **TodoStatusGlyph** | `aria-label` describing status (e.g., "Task in progress"); `aria-hidden="true"` on the glyph character itself if redundant with label |
| **SubagentTree** | `role="tree"` on container; nodes `role="treeitem"`; `aria-expanded` on parent nodes; `aria-level` reflecting depth |
| **SubagentTree keyboard nav** | ArrowUp/Down: previous/next node; ArrowLeft: collapse parent / move to parent; ArrowRight: expand node / move to first child; Enter: trigger primary action (interrupt); Home/End: first/last visible node |
| **Settings sidebar** | `role="tablist"` on nav container; nav items `role="tab"`; content area `role="tabpanel"`; `aria-selected` on active tab |
| **StringListField** | `aria-label` on each remove button (e.g., "Remove {value}"); `aria-live="polite"` region announcing "{value} added" / "{value} removed" |
| **Disclosure** | Header button `aria-expanded`; `aria-controls` pointing to content region |
| **Delegation pause toggle** | `aria-pressed` on the pause button; status change announced via `aria-live` |

---

## 11. Revised Component Inventory

This is the canonical checklist for implementers. Every item below must be created or updated.

### 11.1 New Atoms

- [ ] `desktop/src/ui/atoms/Disclosure.tsx` — Generic expand/collapse
- [ ] `desktop/src/ui/atoms/StringListField.tsx` — Dynamic string list input
- [ ] `desktop/src/ui/atoms/TodoStatusGlyph.tsx` — Status glyph with warm colors
- [ ] `desktop/src/ui/molecules/TreeView.tsx` — Generic tree with warm guide lines

### 11.2 New Molecules

- [ ] `desktop/src/components/TodoItemRow.tsx`
- [ ] `desktop/src/components/TodoList.tsx`
- [ ] `desktop/src/components/SubagentTreeNode.tsx`
- [ ] `desktop/src/components/SubagentSortFilterBar.tsx`
- [ ] `desktop/src/components/SubagentMetricsRow.tsx`
- [ ] `desktop/src/features/settings/SettingsNavItem.tsx`
- [ ] `desktop/src/features/settings/SettingsLayout.tsx`

### 11.3 New Organisms

- [ ] `desktop/src/components/TodoPanel.tsx` — Inline in message stream
- [ ] `desktop/src/components/SubagentTree.tsx`
- [ ] `desktop/src/features/delegation/DelegationSidePanel.tsx` — Registered in `sidePanelStore`

### 11.4 Updated Components

- [ ] `desktop/src/features/settings/SettingsView.tsx` — Add sidebar nav + tab routing
- [ ] `desktop/src/features/settings/ConfigField.tsx` — **Do NOT modify**; use `StringListField` instead
- [ ] `desktop/src/components/AssistantMessage.tsx` — Add `case 'todo_list'` to block switch
- [ ] `desktop/src/stores/side-panel.ts` — Extend tab union to include `'delegation'`
- [ ] `desktop/src/components/WorkspaceSidePanel.tsx` — Add delegation tab button + match case
- [ ] `desktop/src/components/ChatToolbar.tsx` — Add delegation side-panel entry button
- [ ] `desktop/src/services/gateway/http-adapter.ts` — Forward `todos` + add `subagent.*` dispatch
- [ ] `desktop/src/services/gateway/http-adapter.ts` — Add `delegation.*` + `subagent.*` RPC stubs

### 11.5 New Stores

- [ ] `desktop/src/stores/delegation.ts` — Session-scoped subagent state with `createStore`

### 11.6 Type Extensions

- [ ] `desktop/src/types/ui/blocks.ts` — `TodoListBlock`
- [ ] `desktop/src/types/ui/turn.ts` — `LiveTurnState.todos`
- [ ] `desktop/src/types/gateway.ts` — `ToolCompletePayload.todos`, subagent payload types
- [ ] `desktop/src/services/gateway/types.ts` — `GatewayEventMap` subagent entries

---

## 12. RPC Method Stubbing Strategy

The Desktop gateway adapter currently stubs some method groups (`cron`, `mcp`, `skills`, `slash`, `command`) with `notImplemented`. For Phase 3 MVP, the new RPC methods can follow the same pattern:

| Method Group | Methods | Phase 3 MVP | Phase 3.1 |
|--------------|---------|-------------|-----------|
| `delegation` | `.status()`, `.pause()` | Stub with `console.warn` + toast | Full implementation |
| `subagent` | `.interrupt()` | Stub with `console.warn` + toast | Full implementation |

**Rationale:** Stubbing unblocks UI development and allows manual testing of the event pipeline without requiring end-to-end backend verification of every RPC path.
