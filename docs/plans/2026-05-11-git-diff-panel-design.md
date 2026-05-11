# Git Diff Panel — Design Specification

**Date:** 2026-05-11
**Status:** Design Complete (not for execution)
**Scope:** Hermes Desktop (`desktop/`) — SolidJS + Tauri

---

## Overview

Add a **git diff panel** to the Hermes Desktop chat window. The user opens it
via the `...` toolbar menu (or a split-screen shortcut icon), and a structured
diff view slides in on the right side of the chat window. The diff shows
unstaged changes in the agent's current working directory.

Additionally, add a **workspace picker** to the chat empty-state page so the
user can select the working directory before starting a conversation.

---

## Architecture

### Data Flow

```
┌────────────┐   invoke('run_git_diff', { cwd })    ┌──────────────────┐
│  Frontend  │ ────────────────────────────────────▶ │  Tauri Rust      │
│  (SolidJS) │ ◀──────────────────────────────────── │  commands.rs     │
└────────────┘   GitDiffResult (structured JSON)     └───────┬──────────┘
                                                             │
                                                    spawn `git diff`
                                                             │
                                                             ▼
                                                     ┌──────────────────┐
                                                     │  git (system)    │
                                                     └──────────────────┘
```

- **Tauri Rust command** (`run_git_diff`): spawns `git diff --no-color` and
  parses the raw output into a structured `GitDiffResult`. This is consistent
  with existing filesystem commands (`read_file`, `list_dir`, `spawn_process`).
- **No Python sidecar involvement**: git diff is a local filesystem operation,
  not a backend business API call.

### Component Tree (new and modified)

```
ChatView (modified)
├── ChatToolbar (new — extracted from current inline toolbar)
│   ├── WorkspacePath (new)
│   ├── ModelSelector
│   ├── SplitScreenToggle (new — icon button)
│   └── MoreMenu (modified — was plain button, now dropdown)
│       └── "View Diff" / "Hide Diff" menu item
├── ChatBody (new — wrapper for flex split)
│   ├── ChatPane (existing message list + input, flex: 1)
│   └── DiffPanel (new — slides in, 420px default)
│       ├── DiffPanelHeader
│       │   ├── FileTabs
│       │   ├── DiffSummary (+N −M)
│       │   └── CloseButton (×)
│       └── DiffContent
│           └── DiffHunk[] → DiffLine[]
└── WorkspacePicker (new — shown in empty state)
```

---

## 1. Rust Backend: `run_git_diff` Command

**File:** `desktop/src-tauri/src/commands.rs` (add to existing)

### Input

```rust
#[tauri::command]
async fn run_git_diff(cwd: String) -> Result<GitDiffResult, String>
```

### Implementation

1. Resolve `cwd` to canonical path, verify it is a directory.
2. Spawn `git diff --no-color --unified=3` with `current_dir(cwd)`.
3. If `git` is not found, return `Err("git not available")`.
4. Parse raw diff output into structured `GitDiffResult`.

### Output Types

```rust
#[derive(Debug, Serialize)]
struct GitDiffResult {
    files: Vec<DiffFile>,
    summary: DiffSummary,
    working_dir: String,
}

#[derive(Debug, Serialize)]
struct DiffSummary {
    files_changed: u32,
    insertions: u32,
    deletions: u32,
}

#[derive(Debug, Serialize)]
struct DiffFile {
    path: String,
    old_path: Option<String>,     // for renames
    status: FileStatus,           // added | modified | deleted | renamed
    hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize)]
enum FileStatus { Added, Modified, Deleted, Renamed }

#[derive(Debug, Serialize)]
struct DiffHunk {
    header: String,               // "@@ -1,5 +1,7 @@"
    old_start: u32,
    old_count: u32,
    new_start: u32,
    new_count: u32,
    lines: Vec<DiffLine>,
}

#[derive(Debug, Serialize)]
struct DiffLine {
    kind: LineKind,               // Context | Addition | Deletion
    old_lineno: Option<u32>,
    new_lineno: Option<u32>,
    content: String,
}

#[derive(Debug, Serialize)]
enum LineKind { Context, Addition, Deletion }
```

### Error Handling

- Git not installed → `"git not available"` (frontend shows a friendly message)
- `cwd` not a git repo → `"not a git repository"` (or `GitDiffResult { files: [], summary: zero }`)
- `cwd` does not exist → `"directory not found"`
- Git process non-zero exit → `"git diff failed: <stderr>"`

### Registration

Register in `lib.rs` invoke handler:
```rust
.invoke_handler(tauri::generate_handler![
    // ... existing commands ...
    commands::run_git_diff,
])
```

---

## 2. Workspace Picker

### Empty State (no workspace selected)

When `chatStore.workspacePath` is `null`/empty, the ChatView shows:

```
┌─────────────── ChatView ────────────────────────┐
│ [Model Selector]                      [  ...  ] │
│                                                 │
│              ⚕ ASCII Banner                     │
│                                                 │
│          Select a workspace to begin            │
│        ┌──────────────────────────────┐         │
│        │  📁  Choose folder...        │         │
│        └──────────────────────────────┘         │
│                                                 │
│   Hermes needs a working directory to run       │
│   commands and track file changes.              │
│                                                 │
└─────────────────────────────────────────────────┘
```

**Styles** (per `DESIGN.md`):
- Title "Select a workspace to begin": `Anthropic Serif 20px weight 500`,
  `Charcoal Warm (#4d4c48)`, `line-height 1.60`, centered
- Description text: `Anthropic Sans 15px`, `Stone Gray (#87867f)`, centered
- Button: `Warm Sand (#e8e6dc)` bg, `Charcoal Warm (#4d4c48)` text,
  `Anthropic Sans 15px`, `8px` radius, ring shadow
  `0px 0px 0px 1px #d1cfc5`, padding `10px 24px`
- Button hover: ring deepens to `#d1cfc5`

**Interaction**:
- Click button → Tauri `dialog.open({ directory: true, title: "Select Workspace" })`
  → set `chatStore.workspacePath`
- Uses `@tauri-apps/plugin-dialog` (already a dependency in `Cargo.toml`)

### Normal Chat State (workspace selected)

```
┌─────────────── ChatView ────────────────────────┐
│ /home/user/projects/my-app          [Model] [⊞] [⋯] │
│ ─────────────────────────────────────────────── │
│                                                 │
│              聊天内容                            │
│                                                 │
├─────────────────────────────────────────────────┤
│ [Message Input...]                              │
└─────────────────────────────────────────────────┘
```

**Styles**:
- Path: `Anthropic Sans 13px`, `Stone Gray (#87867f)`, left-aligned with
  `padding-left: 8px`
- Bottom divider: `1px solid Border Cream (#f0eee6)`
- Read-only display (user explicitly requested: "不允许修改")
- Path truncation: middle-ellipsis if too long, preserve first and last segments
  (e.g., `/home/user/.../my-app`)
- Max path display width: ~300px before truncation

**Data Store**:
- `chatStore.workspacePath: string | null` — persisted via Tauri store plugin

---

## 3. Diff Panel — Trigger & Layout

### Toolbar Changes

```
┌────────────────────────────────────────────────────────────────────┐
│ /path/to/workspace          [Model Selector ▼]    [⊞]  [  ...  ] │
│                                                       │          │
│                                                ┌──────┴──────┐   │
│                                                │ ⋯ View Diff │   │
│                                                └─────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

From left to right:
1. **WorkspacePath** (read-only, new)
2. **ModelSelector** (existing)
3. **SplitScreenToggle** (new) — icon `⊞` or `layout-sidebar`, toggles diff panel
   - `Anthropic Sans 16px`, `Stone Gray (#87867f)`, hover → `Charcoal Warm (#4d4c48)`
   - Active state (diff open): `Terracotta Brand (#c96442)` color
4. **MoreMenu** (modified from existing `<button>`) — dropdown with:
   - "View Diff" / "Hide Diff" — toggles diff panel
   - Icon: `Icon name="git-branch"` or `Icon name="diff"`, `size={14}`
   - Future expandable with more items

### Split Layout

When diff is active, `ChatView` splits horizontally:

```
┌──────────────────────┬──────────────────────────────┐
│                      │  ┌─ file tabs ──┐  +12 −3   │
│   Chat Pane          │  │ a.rs │ b.rs  │           │
│   (flex: 1)          │  ├──────────────┴───────────┤
│                      │  │                          │
│                      │  │  1  ─  unchanged line    │
│                      │  │  2  +  added line        │
│                      │  │     ─  unchanged         │
│                      │  │  3  −  deleted line      │
│                      │  │     ─  unchanged         │
│                      │  │  4  +  added line        │
│                      │  │                          │
│                      │  └──────────────────────────┘
└──────────────────────┴──────────────────────────────┘
                              420px (default)
                              min 320px (resizable)
```

**Layout**:
- Chat pane: `flex: 1`
- Divider: `1px solid Border Cream (#f0eee6)`, full height, cursor `col-resize`
- Diff panel: default `420px`, min `320px`, user-draggable divider
- Diff panel background: `Parchment (#f5f4ed)`
- Entry animation: slide in from right, `300ms ease-out` (CSS transition on `width` + `opacity`)

### Close Methods (per user: both)

1. **MoreMenu toggle**: "View Diff" → "Hide Diff" when open
2. **SplitScreenToggle icon**: click toggles on/off
3. **Close button (×)**: top-right of diff panel header

---

## 4. Diff Panel — Internal Components

### 4.1 DiffPanelHeader

```
┌──────────────────────────────────────────┐
│  ┌─ file tabs ──────────┐  +12 −3  [×]  │
│  │ a.rs │ b.rs │ c.ts   │               │
│  └──────────────────────┘               │
└──────────────────────────────────────────┘
```

**FileTabs**:
- Container: `Warm Sand (#e8e6dc)` background, full width
- Scrollable horizontally if many files
- **Selected tab**: `Ivory (#faf9f5)` background, top `2px Terracotta Brand (#c96442)` indicator
- **Unselected tab**: `Warm Sand` background, text `Stone Gray (#87867f)`, hover text `Charcoal Warm (#4d4c48)`
- Font: `Anthropic Sans 14px`, max-width `140px`, overflow ellipsis
- Status dot before filename: `●` — green (`#5a8f6c`) for added, orange (`#c96442`) for modified, `Error Crimson (#b53333)` for deleted

**DiffSummary** (`+12 −3`):
- Font: `Anthropic Sans 13px weight 500`
- Insertions: `+N` in muted green (`#5a8f6c`)
- Deletions: `−N` in `Error Crimson (#b53333)`
- Gap between numbers: `12px`
- Right-aligned, `margin-right: 8px`

**CloseButton (×)**:
- `Anthropic Sans 16px`, `Stone Gray (#87867f)`, hover → `Charcoal Warm (#4d4c48)`
- Clickable area `24×24px`, centered
- No background, no border

### 4.2 DiffContent — Scrollable area

```
┌──────────────────────────────────────────┐
│ @@ −1,5 +1,7 @@ src/main.rs             │  ← hunk header
│                                          │
│  1  ─  use std::collections::HashMap;   │  ← context
│  2  +  use std::path::PathBuf;          │  ← addition
│     ─  use serde::Deserialize;          │  ← context
│  3  −  fn old_name() {}                 │  ← deletion
│  4  +  fn new_name() {}                 │  ← addition
│     ─                                  │  ← context (empty)
│                                          │
│ @@ −10,3 +12,4 @@ fn main() {           │  ← next hunk
│  ...                                    │
└──────────────────────────────────────────┘
```

**Font**: `Anthropic Mono 13px` (code MUST use Mono per DESIGN.md), `line-height 1.60`

**Line Numbers**:
- Column width: `48px`, right-aligned
- Color: `Stone Gray (#87867f)`
- User-select: `none`

**Diff Lines**:

| Type | Background | Text Color | Gutter Prefix |
|------|-----------|------------|---------------|
| Context | transparent | `Olive Gray (#5e5d59)` | `─` (or space) |
| Addition | `rgba(90, 143, 108, 0.08)` | `Charcoal Warm (#4d4c48)` | `+` in green |
| Deletion | `rgba(181, 51, 51, 0.06)` | `Charcoal Warm (#4d4c48)` | `−` in `#b53333` |

- Line hover: background opacity `+0.04`
- Line padding: `0 8px`
- Code wrapping: `overflow-x: auto`, no word-wrap (preserve indentation)

**Hunk Headers** (`@@ −1,5 +1,7 @@`):
- Font: `Anthropic Sans 12px`, `Stone Gray (#87867f)`
- Background: `Warm Sand (#e8e6dc)`
- Padding: `2px 8px`, margin between hunks: `8px`
- Full width, no border

### 4.3 Empty / Error States

**Not a git repository:**
```
┌──────────────────────────────────────────┐
│                              [×]         │
│                                          │
│          No git repository               │
│   The current workspace is not a git     │
│   repository. Initialize one with        │
│   `git init` to see diffs here.          │
│                                          │
└──────────────────────────────────────────┘
```
- Title: `Anthropic Serif 16px weight 500`, `Olive Gray (#5e5d59)`
- Body: `Anthropic Sans 14px`, `Stone Gray (#87867f)`, `line-height 1.60`

**No changes (clean working tree):**
```
┌──────────────────────────────────────────┐
│                              [×]         │
│                                          │
│           Working tree clean             │
│         No unstaged changes found.       │
│                                          │
└──────────────────────────────────────────┘
```

---

## 5. State Management

### New Store Fields

In `desktop/src/stores/chat.ts`:

```typescript
// Add to existing chat store
workspacePath: string | null;     // persisted via Tauri store
isDiffOpen: boolean;              // diff panel visibility
diffData: GitDiffResult | null;   // last fetched diff
diffLoading: boolean;             // loading state
diffError: string | null;         // error message
```

### Actions

```typescript
// Workspace
selectWorkspace(): Promise<void>;              // opens native folder picker

// Diff
toggleDiff(): Promise<void>;                   // toggle panel + fetch if opening
fetchDiff(): Promise<void>;                    // calls invoke('run_git_diff')
closeDiff(): void;                             // close panel without re-fetch
selectDiffFile(index: number): void;           // switch active file tab
```

### Edge Cases

- **Workspace not set + user clicks diff**: show message "Select a workspace first"
- **Workspace changes while diff open**: re-fetch diff automatically
- **Rapid toggle**: debounce fetch, 300ms
- **Very large diffs**: cap at 500 hunks / 10,000 lines; show "Diff truncated" message
- **Binary files in diff**: show placeholder "Binary file (not shown)"

---

## 6. Files to Create / Modify

### New Files

| File | Purpose |
|------|---------|
| `desktop/src/modules/diff/DiffPanel.tsx` | Diff panel container component |
| `desktop/src/modules/diff/DiffPanel.module.css` | Diff panel styles |
| `desktop/src/modules/diff/DiffContent.tsx` | Scrollable diff content area |
| `desktop/src/modules/diff/DiffHunk.tsx` | Single hunk renderer |
| `desktop/src/modules/diff/DiffLine.tsx` | Single diff line renderer |
| `desktop/src/modules/diff/FileTabs.tsx` | File tab bar |
| `desktop/src/modules/diff/DiffSummary.tsx` | +N −N summary |
| `desktop/src/modules/diff/index.ts` | Module barrel export |
| `desktop/src/modules/workspace/WorkspacePicker.tsx` | Empty-state workspace picker |
| `desktop/src/modules/workspace/WorkspacePath.tsx` | Toolbar path display |
| `desktop/src/modules/workspace/index.ts` | Module barrel export |
| `desktop/src/modules/chat/MoreMenu.tsx` | Dropdown menu component |
| `desktop/src/modules/chat/ChatToolbar.tsx` | Extracted toolbar component |
| `desktop/src/modules/chat/SplitScreenToggle.tsx` | Split-screen icon button |
| `desktop/src/types/diff.ts` | TypeScript types for GitDiffResult |

### Modified Files

| File | Changes |
|------|---------|
| `desktop/src-tauri/src/commands.rs` | Add `run_git_diff` command |
| `desktop/src-tauri/src/lib.rs` | Register `run_git_diff` in handler |
| `desktop/src/modules/chat/ChatView.tsx` | Integrate toolbar, diff panel, workspace picker |
| `desktop/src/modules/chat/ChatView.module.css` | Split layout styles |
| `desktop/src/stores/chat.ts` | Add workspace + diff state fields and actions |
| `desktop/src/services/api/transports/http/state.ts` | Add workspacePath to state transport (if backed by sidecar) |

### Test Files

| File | Purpose |
|------|---------|
| `desktop/src-tauri/tests/diff_tests.rs` | Rust diff parsing tests |
| `desktop/src/modules/diff/__tests__/DiffPanel.test.tsx` | Diff panel rendering |
| `desktop/src/modules/workspace/__tests__/WorkspacePicker.test.tsx` | Picker behavior |
| `desktop/src/modules/chat/__tests__/MoreMenu.test.tsx` | Dropdown behavior |

---

## 7. Design Decisions Recap

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Diff shows unstaged `git diff` only | User confirmed: working tree changes |
| 2 | Tauri Rust command, not Python sidecar | Git operations are filesystem, aligned with `read_file` etc. |
| 3 | Structured parse in Rust | Type safety, speed, no JS diff-parsing dependency |
| 4 | Split layout: chat left, diff right (420px) | User explicitly chose horizontal split |
| 5 | Diff panel style follows DESIGN.md (Claude) | Per user: "前端UI设计需要遵守 DESIGN.md" |
| 6 | Workspace picker in empty state + read-only in toolbar | User: "不允许修改" after selection |
| 7 | Workspace from agent session CWD | Diff uses agent's working directory |
| 8 | Three close methods: menu toggle, icon toggle, × button | User chose option C |
| 9 | Split-screen toggle icon next to `...` | User: "在...右侧加个分屏的快捷icon" |
| 10 | All text/colors/tokens per DESIGN.md warm palette | No cool grays, Anthropic fonts, Terracotta accents |

---

## 8. Out of Scope (YAGNI)

- ❌ Staged changes (`git diff --staged`) — user said unstaged only
- ❌ Inline editing of diff content — read-only view
- ❌ Accept/reject individual hunks — not requested
- ❌ Dark mode for diff panel — follows existing theme system
- ❌ Multi-repo diff — single workspace directory
- ❌ Diff between two arbitrary commits — only working tree vs HEAD
- ❌ Workspace path editing after selection — user: "不允许修改"
