# Design System Inspired by Claude (Anthropic)

## 1. Visual Theme & Atmosphere

Hermes Desktop is a developer-grade AI agent interface built on a blue-tinted glass canvas — precise, focused, and technically confident. The entire experience is grounded in a cool blue-white surface (`#f8faff` seed, rendering as `color-mix(in srgb, #f8faff 92%, #f3f3f3)` ≈ `#f6f8fe`) that reads as clean glass rather than paper or screen. Where consumer AI products lean into warmth or editorial softness, Hermes signals tool-grade intentionality through a single electric-blue accent and a disciplined neutral ladder.

The primary brand move is **Nous Blue** (`#0053fd`) — a pure electric blue used as the single chromatic seed for every surface fill, stroke, and interactive state in the system. Rather than a fixed palette, fills and borders are generated dynamically via double-nested `color-mix`, blending the accent seed against the base ink at decreasing percentages. This creates a cohesive tonal family where every element — sidebar, card, input, hover — reads as the same hue family at different intensities.

Typography runs the system font stack (Segoe UI / SF Pro / system-ui) — no custom display face. This anchors the interface firmly in OS-native territory, reinforcing the tool character. Code surfaces use Cascadia Code / JetBrains Mono.

**Key Characteristics:**
- Blue-tinted glass canvas (`#f8faff` seed) — cool, precise, developer-native
- System font stack (Segoe UI / SF Pro / system-ui) for UI; Cascadia Code for code
- Nous Blue accent (`#0053fd`) — single chromatic seed for the entire fill/stroke/interactive system
- Cool-neutral tones with blue mix-in ladder — no warm yellow-brown undertones
- Product UI screenshots as primary visual content — no decorative illustration
- Ring-based shadow system (`0px 0px 0px 1px`) creating border-like depth without visible borders
- Dense information layout with tight spacing (0.8125rem base, 1.125rem line-height)

## 2. Color Palette & Roles

### Primary
- **Ink / Near Black** (`#17171a`): The primary text color — near-black with a barely perceptible cool tint. Used as the `--ui-base` seed for all text-opacity tokens.
- **Nous Blue** (`#0053fd`): The single chromatic accent — a pure electric blue used as `--ui-accent` seed for every fill, stroke, and ring in the system. Never used as a body-text color.

### Secondary & Accent
- **Error Red** (`#cf2d56`): Semantic error and destructive state color (`--ui-red` light mode).
- **Focus Ring** (`#0053fd`): Same value as Nous Blue — input focus rings use `--dt-ring` which resolves to the primary accent.

### Surface & Background

> Three layers: **seed** (design intent), **rendered** (actual CSS mix result), **preset token** (theme-switch value).

- **Canvas seed** (`#f8faff`): The blue-tinted background seed. Not rendered directly.
- **Canvas rendered** (`color-mix(in srgb, #f8faff 92%, #f3f3f3)` ≈ `#f6f8fe`): Actual chrome/page background (`--ui-bg-chrome`).
- **Sidebar** (`#f3f7ff`): Sidebar background seed; mix ratio = 100% so rendered value equals seed (`--ui-bg-sidebar`).
- **Card / Editor** (`color-mix(in srgb, #ffffff 22%, #fcfcfc)` ≈ `#fefefe`): Card and editor surface (`--ui-bg-editor`).
- **Dark Surface** (preset `#0d2f86`): Nous dark theme card surface — `nousTheme.darkColors.card`. Only applies when dark mode is active.
- **Dark Sidebar** (preset `#09286f`): Nous dark theme sidebar — `nousTheme.darkColors.sidebarBackground`.

### Fill Ladder

Fills are generated dynamically. Both `accent` and `base` are resolved at runtime from theme tokens:
```
accent = #0053fd  (--ui-accent = --theme-midground)
base   = #17171a  (--ui-base   = --theme-foreground)

Fill primary:    color-mix(in srgb, accent 16%, color-mix(in srgb, base 10%, transparent))
Fill secondary:  color-mix(in srgb, accent 11%, color-mix(in srgb, base  7%, transparent))
Fill tertiary:   color-mix(in srgb, accent  8%, color-mix(in srgb, base  5%, transparent))
Fill quaternary: color-mix(in srgb, accent  5%, color-mix(in srgb, base  4%, transparent))
Fill quinary:    color-mix(in srgb, accent  3%, color-mix(in srgb, base  3%, transparent))
```

### Stroke Ladder
```
Stroke primary:    color-mix(in srgb, accent 24%, color-mix(in srgb, base 10%, transparent))
Stroke secondary:  color-mix(in srgb, accent 16%, color-mix(in srgb, base  7%, transparent))
Stroke tertiary:   color-mix(in srgb, accent 10%, color-mix(in srgb, base  5%, transparent))
Stroke quaternary: color-mix(in srgb, accent  6%, color-mix(in srgb, base  3%, transparent))
```

### Text Ladder
```
Text primary:    color-mix(in srgb, base 94%, transparent)
Text secondary:  color-mix(in srgb, base 74%, transparent)
Text tertiary:   color-mix(in srgb, base 54%, transparent)
Text quaternary: color-mix(in srgb, base 36%, transparent)
```

### Borders & Rings
- **Border default** (`--dt-border`): Resolves to stroke-secondary.
- **Input border** (`--dt-input`): `color-mix(in srgb, #0053fd 22%, color-mix(in srgb, #17171a 10%, transparent))` — slightly stronger than stroke-primary.
- **Focus ring** (`--dt-ring`): `#0053fd` (primary blue).
- **Composer ring**: `#17171a` base in light mode, `#ffe6cb` warm in Nous dark mode.

### Semantic Colors
- **Error / Destructive** (`#cf2d56`): `--ui-red` / `--dt-destructive`.
- **Warning** (`#db704b`): `--ui-orange`.
- **Success** (`#1f8a65`): `--ui-green`.
- **Info** (`#0053fd`): Shares primary blue (`--ui-blue`).

### Color-Mix Fill System
Hermes uses **no static fill palette**. Depth and surface hierarchy come entirely from the double-nested `color-mix` ladder — same hue family at decreasing accent/ink percentages. This is the system's depth mechanism, replacing static gray surfaces.

## 3. Typography Rules

### Font Family
- **UI / Body**: `"Segoe WPC", "Segoe UI", -apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif`
- **Code**: `"Cascadia Code", "JetBrains Mono", "SF Mono", ui-monospace, Menlo, Consolas, monospace`

*No custom display typeface. The system font stack is intentional — it anchors the interface in OS-native territory and ensures zero font-loading overhead.*

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Conversation text | system-ui | 0.8125rem (13px) | 400 | 1.125rem | 0 | Base density — chat messages |
| Tool / caption | system-ui | 0.75rem (12px) | 400 | 1rem | 0 | Tool call labels, captions |
| Body standard | system-ui | 0.875rem (14px) | 400 | 1.25 | 0 | Settings, lists, descriptions |
| Body large | system-ui | 1rem (16px) | 400 | 1.5 | 0 | Headings, modal titles |
| Label / badge | system-ui | 0.75rem (12px) | 500 | 1.25 | 0.12px | Badges, small labels |
| Overline | system-ui | 0.625rem (10px) | 400 | 1.60 | 0.5px | Uppercase section labels |
| Code | Cascadia Code / JetBrains Mono | 0.8125rem (13px) | 400 | 1.5 | -0.02em | All code, tool output, terminal |

### Principles
- **System sans everywhere**: Single font family for both headings and UI text — no serif/sans split. This creates a tool-native, OS-integrated feel.
- **Dense by default**: Base font size is 0.8125rem (13px), line-height 1.125rem. This is intentionally tighter than marketing or editorial contexts.
- **Mono for all code surfaces**: Cascadia Code / JetBrains Mono on every code block, tool output, and terminal surface.
- **Micro letter-spacing on labels**: Small text (12px and below) uses deliberate letter-spacing (0.12px–0.5px) to maintain readability at tiny sizes.

## 4. Component Stylings

### Buttons

**Secondary / Default**
- Background: Fill tertiary (`color-mix(in srgb, #0053fd 8%, color-mix(in srgb, #17171a 5%, transparent))`)
- Text: Text primary (`color-mix(in srgb, #17171a 94%, transparent)`)
- Padding: 0px 12px 0px 8px (asymmetric — icon-first layout)
- Radius: comfortably rounded (8px)
- Shadow: ring-based (`stroke-secondary 0px 0px 0px 1px`)
- The workhorse button — blue-tinted surface, tool-native

**Primary / Brand**
- Background: Nous Blue (`#0053fd`)
- Text: `#fcfcfc`
- Padding: 8px 16px
- Radius: comfortably rounded (8px)
- Shadow: ring-based (`#0053fd 0px 0px 0px 1px`)
- The primary CTA — the only filled chromatic button

**Ghost / Elevated**
- Background: Card surface (`color-mix(in srgb, #ffffff 22%, #fcfcfc)`)
- Text: Text primary
- Padding: 8px 16px 8px 12px
- Radius: generously rounded (8–12px)
- Border: `1px solid stroke-secondary`
- Clean, elevated button for card surfaces

**Destructive**
- Background: `#cf2d56`
- Text: `#ffffff`
- Radius: 8px
- Used for delete / irreversible actions only

### Cards & Containers
- Background: Card surface (`color-mix(in srgb, #ffffff 22%, #fcfcfc)`) on light; dark preset `#0d2f86` on Nous dark
- Border: `1px solid stroke-secondary` on light; `1px solid #3158ad` on Nous dark
- Radius: comfortably rounded (8px) for standard cards; generously rounded (12–16px) for featured panels
- Shadow: `var(--shadow-sm)` — `0 0 0 1px color-mix(in srgb, #17171a 6%, transparent), 0 2px 8px color-mix(in srgb, #000 4%, transparent)`
- Ring shadow: `0px 0px 0px 1px stroke-secondary` for interactive card states
- Section borders: `1px 0px 0px` (top-only) for list item separators

### Inputs & Forms
- Text: Text primary (`color-mix(in srgb, #17171a 94%, transparent)`)
- Padding: 1.6px 12px (very compact vertical)
- Border: `1px solid` `--dt-input` = `color-mix(in srgb, #0053fd 22%, color-mix(in srgb, #17171a 10%, transparent))`
- Focus: ring `2px solid #0053fd` — primary blue, no separate focus color
- Radius: generously rounded (12px)

### Navigation
- Sticky top nav / sidebar with canvas-rendered background (`#f6f8fe`)
- Logo: Hermes wordmark in ink primary (`#17171a`)
- Links: text-secondary (`color-mix(in srgb, #17171a 74%, transparent)`) default; text-primary on hover
- Nav border: `1px solid stroke-secondary`
- Active state: fill-tertiary background + text-primary
- Hover background: `--ui-row-hover-background` (fill quinary)

### Image Treatment
- Product screenshots showing the Claude chat interface
- Generous border-radius on media (16–32px)
- Embedded video players with rounded corners
- Dark UI screenshots provide contrast against warm light canvas
- Organic, hand-drawn illustrations for conceptual sections

### Distinctive Components

**Tool Activity Rows**
- Live tool call cards with icon, label, status badge, and collapsible output
- Background: fill-quaternary; border: stroke-tertiary (top-only)
- Active/streaming state: left accent bar in Nous Blue (`#0053fd`)

**Composer / Chat Input**
- Floating surface with `var(--shadow-composer-focus)` on focus: multi-layer ring in primary blue
- Min-height 1.625rem, max-height 9.375rem, width capped at 48.75rem
- Background: `--ui-bg-input` (`#fcfcfc`)

**Multi-Theme Skin System**
- Light (Nous), Dark (Psyche blue `#0d2f86` + warm cream `#ffe6cb`), Midnight, Ember, Mono, Cyberpunk, Slate
- All skins use the same token names; only the seed values change
- Theme applied via CSS custom property overrides — no class switching

## 5. Layout Principles

### Spacing System
- Base unit: 8px
- Scale: 3px, 4px, 6px, 8px, 10px, 12px, 16px, 20px, 24px, 30px
- Button padding: asymmetric (0px 12px 0px 8px) or balanced (8px 16px)
- Card internal padding: approximately 24–32px
- Section vertical spacing: generous (estimated 80–120px between major sections)

### Grid & Container
- Max container width: approximately 1200px, centered
- Hero: centered with editorial layout
- Feature sections: single-column or 2–3 column card grids
- Model comparison: clean 3-column grid
- Full-width dark sections breaking the container for emphasis

### Whitespace Philosophy
- **Editorial pacing**: Each section breathes like a magazine spread — generous top/bottom margins create natural reading pauses.
- **Serif-driven rhythm**: The serif headings establish a literary cadence that demands more whitespace than sans-serif designs.
- **Content island approach**: Sections alternate between light and dark environments, creating distinct "rooms" for each message.

### Border Radius Scale
- Sharp (4px): Minimal inline elements
- Subtly rounded (6–7.5px): Small buttons, secondary interactive elements
- Comfortably rounded (8–8.5px): Standard buttons, cards, containers
- Generously rounded (12px): Primary buttons, input fields, nav elements
- Very rounded (16px): Featured containers, video players, tab lists
- Highly rounded (24px): Tag-like elements, highlighted containers
- Maximum rounded (32px): Hero containers, embedded media, large cards

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Flat (Level 0) | No shadow, no border | Canvas background, inline text |
| Contained (Level 1) | `1px solid stroke-secondary` (light) or `1px solid #3158ad` (Nous dark) | Standard cards, sections |
| Ring (Level 2) | `0px 0px 0px 1px stroke-secondary` | Interactive cards, buttons, hover states |
| Whisper (Level 3) | `rgba(0,0,0,0.05) 0px 4px 24px` | Elevated feature cards, product screenshots |
| Inset (Level 4) | `inset 0px 0px 0px 1px` at 15% opacity | Active/pressed button states |

**Shadow Philosophy**: Claude communicates depth through **warm-toned ring shadows** rather than traditional drop shadows. The signature `0px 0px 0px 1px` pattern creates a border-like halo that's softer than an actual border — it's a shadow pretending to be a border, or a border that's technically a shadow. When drop shadows do appear, they're extremely soft (0.05 opacity, 24px blur) — barely visible lifts that suggest floating rather than casting.

### Decorative Depth
- **Light/Dark theme switching**: The most dramatic depth effect comes from switching between the Nous light canvas (`#f6f8fe`) and Nous dark (`#0d2f86`) presets — entire surfaces shift via seed overrides.
- **Blue ring halos**: Button and card interactions use ring shadows derived from the stroke ladder — always blue-mix tinted, never plain gray.

## 7. Do's and Don'ts

### Do
- Use the canvas-rendered value (`color-mix(in srgb, #f8faff 92%, #f3f3f3)`) for page backgrounds — the blue tint IS the Nous identity
- Use Nous Blue (`#0053fd`) only for primary CTAs, active states, and the highest-signal brand moments
- Generate all fills and strokes from the `color-mix` ladder — never introduce static gray surfaces
- Use ring shadows (`0px 0px 0px 1px stroke-secondary`) for interactive element states instead of drop shadows
- Keep body type dense: 0.8125rem base, 1.125rem line-height — this is a tool, not a reading app
- Apply 8px radius on buttons and inputs; 12–16px on cards — neither pill nor sharp
- Use `--ui-red #cf2d56` for all error/destructive states — no other red variants

### Don't
- Don't use warm yellow-brown tints anywhere — the palette is exclusively cool/neutral with blue mix-in
- Don't hardcode static hex fills for surfaces — always derive from the `color-mix` ladder
- Don't use serif or display typefaces — system-ui stack only
- Don't apply heavy drop shadows — depth comes from ring shadows and surface mix-ladder contrast
- Don't use pure white (`#ffffff`) as a page background — the canvas seed is `#f8faff`
- Don't use emoji as icons — Lucide SVG icons only
- Don't mix accent colors from different skins — each skin is self-contained via its seed overrides
- Don't reduce body line-height below 1.10 — tool density has a floor

## 8. Responsive Behavior

### Breakpoints
| Name | Width | Key Changes |
|------|-------|-------------|
| Small Mobile | <479px | Minimum layout, stacked everything, compact typography |
| Mobile | 479–640px | Single column, hamburger nav, reduced heading sizes |
| Large Mobile | 640–767px | Slightly wider content area |
| Tablet | 768–991px | 2-column grids begin, condensed nav |
| Desktop | 992px+ | Full multi-column layout, expanded nav, maximum hero typography (64px) |

### Touch Targets
- Buttons use generous padding (8–16px vertical minimum)
- Navigation links adequately spaced for thumb navigation
- Card surfaces serve as large touch targets
- Minimum recommended: 44x44px

### Collapsing Strategy
- **Navigation**: Full horizontal nav collapses to hamburger on mobile
- **Feature sections**: Multi-column → stacked single column
- **Hero text**: 64px → 36px → ~25px progressive scaling
- **Model cards**: 3-column → stacked vertical
- **Section padding**: Reduces proportionally but maintains editorial rhythm
- **Illustrations**: Scale proportionally, maintain aspect ratios

### Image Behavior
- Product screenshots scale proportionally within rounded containers
- Illustrations maintain quality at all sizes
- Video embeds maintain 16:9 aspect ratio with rounded corners
- No art direction changes between breakpoints

## 9. Agent Prompt Guide

### Quick Color Reference
- Brand CTA / Primary: "Nous Blue (#0053fd)"
- Page Background (rendered): "color-mix(in srgb, #f8faff 92%, #f3f3f3) ≈ #f6f8fe"
- Canvas Seed: "#f8faff"
- Sidebar: "#f3f7ff"
- Card Surface: "color-mix(in srgb, #ffffff 22%, #fcfcfc) ≈ #fefefe"
- Primary Text: "color-mix(in srgb, #17171a 94%, transparent)"
- Secondary Text: "color-mix(in srgb, #17171a 74%, transparent)"
- Tertiary Text: "color-mix(in srgb, #17171a 54%, transparent)"
- Border default: "stroke-secondary = color-mix(in srgb, #0053fd 16%, color-mix(in srgb, #17171a 7%, transparent))"
- Error: "#cf2d56"
- Dark Surface (Nous dark preset): "#0d2f86"

### Example Component Prompts
- "Create a chat row on the canvas surface (#f6f8fe). Use system-ui at 0.8125rem, line-height 1.125rem. Primary text at color-mix(in srgb, #17171a 94%, transparent). Add a 1px top border in stroke-secondary."
- "Design a tool activity card with fill-quaternary background (color-mix(in srgb, #0053fd 5%, color-mix(in srgb, #17171a 4%, transparent))). Left accent bar 2px solid #0053fd. Text at 0.75rem secondary color. Ring shadow 0px 0px 0px 1px stroke-tertiary."
- "Build a primary CTA button: background #0053fd, text #fcfcfc, 8px radius, padding 8px 16px, ring shadow 0px 0px 0px 1px #0053fd."
- "Create an input field: background #fcfcfc, border 1px solid color-mix(in srgb, #0053fd 22%, color-mix(in srgb, #17171a 10%, transparent)), 12px radius, focus ring 2px solid #0053fd."
- "Design a sidebar nav item: default background transparent, hover background fill-quinary (color-mix(in srgb, #0053fd 3%, color-mix(in srgb, #17171a 3%, transparent))), active background fill-tertiary. Text secondary by default, text primary on active."

### Iteration Guide
1. Focus on ONE component at a time
2. Reference token names first — "use stroke-secondary" not "use a blue border"
3. Always derive fills from the `color-mix` ladder — no static gray hex values
4. Font is always system-ui / Segoe UI / SF Pro — no serif, no display
5. For shadows, use "ring shadow (0px 0px 0px 1px stroke-secondary)" — never generic "drop shadow"
6. Specify the surface layer — "on canvas (#f6f8fe)" or "on card surface (#fefefe)" or "on sidebar (#f3f7ff)"
7. For dark mode, reference preset token names — "Nous dark card (#0d2f86)" not arbitrary dark values
