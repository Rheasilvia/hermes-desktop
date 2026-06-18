# Hermes Tauri Desktop Design System

This document is the design authority for the Tauri desktop app in `desktop/`.
It does not apply to the Electron app in `apps/desktop/`.

Hermes Desktop is a dense developer tool for running and inspecting an AI agent.
The UI should feel native, quiet, precise, and repeatable. Do not treat it as a
marketing site, editorial page, or Claude clone.

## 1. Product Character

Hermes is a desktop workbench:

- Chat is the primary workspace.
- Supporting tools live around the chat, not in large marketing sections.
- Controls should be compact and predictable.
- Visual interest comes from hierarchy, spacing, state, and real content.
- Decorative gradients, oversized hero sections, nested cards, and pill-shaped
  generic buttons are out of scope.

Use Claude as a reference only for calmness and restraint. Use IDEs and terminal
tools as the stronger reference for density, state clarity, and repeated use.

## 2. Design Principles

### Desktop First

The app is a native desktop surface. Prefer OS-like controls, compact rows,
visible affordances, and stable panel behavior. Avoid web landing-page patterns.

### Dense But Legible

Most UI text should sit in the 12-14px range. Use whitespace deliberately, but
do not make operational surfaces sparse. Users should be able to scan state,
files, diffs, tool activity, and terminal output without decorative padding.

### Neutral Surface, Focused Accent

The base UI is neutral/cool. The primary accent is blue. Blue should identify
active, focus, selected, and primary states; it should not wash every surface
with the same intensity.

### Familiar Control Shapes

Icon buttons are square-ish with 6-8px radius. Text buttons use 8px radius.
Only badges, status pills, tiny counters, and segmented selected indicators may
use pill radius. Avoid oval buttons for ordinary actions.

### No Empty Shells

If a tool view is not implemented, do not route users into an empty page. Hide it
or mark it as unavailable in the menu with a clear disabled state.

## 3. Token Model

CSS modules must use tokens from `desktop/src/styles/tokens.css` and theme
overrides from `desktop/src/styles/themes/*.css`.

Some token names are historical and do not match the current visual direction.
Treat them semantically:

| Token | Current Semantic Role |
| --- | --- |
| `--color-parchment` | App canvas / panel background |
| `--color-terracotta` | Primary brand accent |
| `--color-charcoal` | Strong text |
| `--color-charcoal-warm` | Muted text |
| `--color-cream` | Raised surface / hover surface |
| `--color-warm-gray` | Subtle tinted control fill |
| `--font-serif` | Legacy only; do not use for new desktop UI |

Do not add hardcoded CSS colors in component modules. If a new semantic color is
needed, add or reuse a token first.

## 4. Color

### Light Theme

- Canvas: cool blue-white via `--color-parchment` / `--color-background`.
- Surface: `--color-surface` and `--color-surface-raised`.
- Text: `--color-on-surface`, `--color-on-surface-muted`,
  `--color-on-surface-dim`.
- Border: `--color-border`, `--color-border-light`.
- Focus: `--color-border-focus`.
- Primary: `--color-primary`.

### Dark Theme

Dark theme uses neutral depth with blue as the active accent. Code and terminal
surfaces may be darker than ordinary panels, but must keep visible cursor,
selection, and focus states.

### Earth Theme

Earth theme is a separate user-selectable skin. Do not let warm earth colors
leak into the default light theme.

### Usage Rules

Do:

- Use blue for active navigation, focus rings, selected rows, and primary
  commands.
- Use success/warning/error/info tokens for semantic status only.
- Use `--color-code-block-bg` for code and terminal surfaces.
- Keep terminal themes neutral and high contrast.

Do not:

- Build a one-note all-blue interface.
- Use purple-blue gradients as page decoration.
- Use beige/cream/brown as the default visual identity.
- Use pure black terminal placeholders without visible status or cursor.

## 5. Typography

### Families

- UI: `--font-sans`
- Code, diffs, terminal, inline literals: `--font-mono`
- New desktop UI must not use `--font-serif`.

### Scale

| Role | Token | Use |
| --- | --- | --- |
| Caption / toolbar metadata | `--text-xs` | Status, file metadata, terminal cwd |
| Primary UI text | `--text-sm` | Buttons, menu rows, list rows |
| Panel title | `--text-base` or `--text-sm` + semibold | Tool panel headers |
| Page title | `--text-lg` / `--text-xl` | Settings or full page headings |

Letter spacing should normally be `0`. Avoid negative tracking in compact UI.

## 6. Spacing And Radius

Spacing uses the 4px token scale:

- `--space-1`: tight icon/text gaps.
- `--space-2`: compact internal gaps.
- `--space-3`: standard toolbar and row padding.
- `--space-4`: panel menu padding.
- `--space-6+`: page-level grouping only.

Radius:

- 6-8px: buttons, tool rows, inputs, compact cards.
- 12px: larger modals or major surfaces when needed.
- 16px+: rare; avoid for repeated operational cards.
- Pill: badges, status pills, counters only.

Do not put cards inside cards. Page sections are layout regions; cards are for
individual repeated items, modals, and genuinely framed tools.

## 7. Core Surfaces

### Chat Workspace

The chat view is the center of the app. Supporting panels should not compete
with it visually. Composer, prompt cards, approvals, and tool activity should
share compact spacing and stable heights.

### Right Tools Dock

The right dock is a tool switcher, not a tab strip.

Layout:

- The window-top right tools split belongs to the app shell, not `ChatView`.
- When docked, the vertical separator and drag handle run from the top of the
  window to the bottom.
- The tools dock content starts below the title bar so the top-right toggle and
  window controls remain reachable.
- The title bar belongs to the right workspace frame: when the primary Sidebar
  is visible it starts at the Sidebar separator; when the Sidebar is hidden it
  spans the full window width.
- The content region reserves the right-side dock width so chat content never
  sits underneath the dock.
- On narrow widths, the tools dock becomes an overlay; the separator and drag
  handle are hidden.
- The primary left Sidebar is a full-height dock from the top of the window to
  the bottom. Its content keeps a titlebar-height top safe area for native
  window controls.
- Sidebar and tools separators use `--color-shell-separator`: a 1px,
  low-contrast shell line. Resize hit targets may be wider, but must remain
  visually quiet.

Entry:

- TitleBar and ChatToolbar right-side `panel-right` buttons toggle the tools
  dock.
- The TitleBar toggle is the only close/hide control for the dock.
- Opening without a target lands on the tools menu.
- Direct commands may open a specific view, such as Terminal.

Menu:

- Supported items: Review, Terminal, Files, Delegation.
- The menu has no panel header. The item list is centered vertically and
  horizontally within the available panel body.
- Use one row per tool with icon, title, and short description.
- Row height should be stable around 56-64px.
- Row radius is 6-8px.
- Icons sit in a 28-32px square container.
- Do not use pill-shaped tool rows.
- Do not render an internal close button in the menu.

Subpages:

- Review, Files, and Delegation may use a compact page header with back, title,
  and a non-interactive trailing spacer for visual balance.
- Terminal owns its own tab-style header and must not receive the generic page
  header.
- Returning to the menu does not destroy long-lived tool sessions.
- Hiding the dock from the TitleBar toggle does not imply destructive cleanup.

### Review

Review reuses the existing diff panel. It should read as an inspection surface:
file list, diff content, and summary state. Avoid decorative cards.

### Files

Files reuses the workspace tree. Use compact rows and clear active/hover states.
Do not over-pad the tree.

### Delegation

Delegation is an operational status panel. Prioritize current task state,
subagent identity, and actionable failure/complete states over illustration.

### PTY Terminal

Terminal is an embedded Tauri PTY, rendered by xterm.js and backed by Rust
`portable-pty`.

Behavior:

- Lazy start on first Terminal activation.
- Start only after the terminal host has non-zero width and height.
- Switching tools or closing the right panel keeps the shell alive.
- Terminal page provides explicit Stop and Restart.
- App exit cleans up the PTY.
- V1 is a single terminal session, not tabs.

Visuals:

- The terminal header uses a tab-strip treatment inspired by modern terminal
  apps: active tab chip on the left, optional single-session add-tab affordance,
  status/actions on the right.
- The active tab shows the current workspace label and uses a compact 6-12px
  radius, not a full-width title bar.
- Light theme uses a light terminal canvas. Dark and earth themes use dark code
  canvases. xterm colors must switch with `html[data-theme]`.
- Cursor must be visible.
- When no PTY output has arrived, show a status overlay such as
  "Shell started. Waiting for output..." rather than a blank black rectangle.
- Error and stopped states must be visible outside the xterm buffer.

Controls:

- Back to tools: icon button in the terminal header.
- Restart: icon button, 28-32px square, 8px radius.
- Stop: icon button, 28-32px square, 8px radius.
- Disable controls only while startup is in progress or no session exists.

## 8. Component Rules

### Buttons

Icon buttons:

- 28-32px square for toolbars.
- Use Lucide icons through `Icon`.
- 6-8px radius.
- Transparent by default, tokenized hover fill.
- Visible focus ring.

Text buttons:

- 8px radius.
- Use icons when the action has a familiar symbol.
- Avoid large pill CTAs inside desktop tool surfaces.

Primary buttons:

- Reserve for the strongest forward action on a surface.
- Use `--color-primary` background and `--color-on-primary` text.

### Inputs

- Use tokenized surface, border, text, and focus ring.
- Label compactly.
- Preserve keyboard focus and visible validation/error state.

### Status And Badges

- Status badges may be pill-shaped.
- Keep text short: Running, Stopped, Error, Coming soon.
- Use semantic tokens for success/warning/error.

### Empty And Loading States

Empty states in operational panels should be brief and actionable. Do not use
large illustrations. Loading states should preserve layout size when possible.

## 9. Interaction And Accessibility

Required:

- All icon-only buttons need `aria-label`.
- Keyboard focus must be visible.
- Disabled states must be visually distinct and non-clickable.
- Text must not overflow buttons, rows, or panels.
- Tool panels must remain usable at narrow overlay widths.
- Terminal focus should move into the xterm when the Terminal view becomes
  active.

Motion:

- Use short opacity/transform/color transitions.
- Do not animate layout in ways that move the composer, terminal, or tool rows
  during normal use.

## 10. Responsive Behavior

Desktop wide:

- Chat and right tools dock can sit side by side.
- Right dock keeps the existing draggable width behavior.

Narrow desktop:

- Right tools dock becomes an overlay.
- Overlay width should stay within the viewport and preserve usable terminal
  dimensions.

Mobile-sized webviews are not the primary target. If a surface must fit, reduce
columns and truncate secondary text before shrinking primary controls below
usable sizes.

## 11. Implementation Checklist

Before shipping a UI change:

- Uses existing tokens; no hardcoded CSS colors in CSS modules.
- Uses 6-8px radius for ordinary buttons and rows.
- Does not add nested cards or marketing/hero composition.
- Has hover, active, disabled, focus, loading, empty, and error states where
  relevant.
- Text fits at narrow right-panel widths.
- Tool panel close/switch behavior does not destroy long-lived sessions unless
  the user explicitly stops them.
- Terminal has visible status when starting, waiting for layout, waiting for
  first output, stopped, or errored.

## 12. Agent Prompt Guide

When asking an agent to build Hermes Desktop UI, specify:

- "Target `desktop/` Tauri only."
- "Use the Hermes Desktop design system, not Claude marketing/editorial style."
- "Keep operational density; no hero, no nested cards, no decorative gradients."
- "Use 6-8px radius for normal controls; pill only for status/badges."
- "Use existing tokens from `desktop/src/styles/tokens.css`."
- "For terminal work, preserve PTY lifecycle: switch/close hides, Stop kills."
