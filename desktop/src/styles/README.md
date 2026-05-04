# Hermes Desktop — Design Tokens

CSS custom properties for the Hermes Desktop App. All tokens are defined as CSS custom properties on `:root` and can be overridden per-theme using `[data-theme="..."]` selectors.

## File Structure

```
src/styles/
├── tokens.css       # All CSS custom properties (design tokens)
├── reset.css        # CSS normalize/reset
├── global.css       # Main entry point — imports all style sheets
└── themes/
    ├── dark.css     # Dark mode overrides
    └── earth.css    # Earth-tone theme overrides
```

## Usage

Import the global stylesheet in your entry component:

```tsx
import "@/styles/global.css";
```

Then use any token as a CSS variable:

```css
.my-component {
  color: var(--color-on-surface);
  background: var(--color-surface);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  box-shadow: var(--shadow-md);
  transition: var(--transition-normal);
}
```

## Token Categories

### Colors: Brand
| Token | Default | Description |
|-------|---------|-------------|
| `--color-parchment` | `#F5F0E8` | Warm paper background |
| `--color-terracotta` | `#C75B3A` | Primary accent |
| `--color-sage` | `#7A8B6F` | Secondary accent |
| `--color-charcoal` | `#2D2D2D` | Dark text |
| `--color-cream` | `#FFFDF7` | Light surface |
| `--color-stone` | `#9B9589` | Muted text |
| `--color-warm-gray` | `#D4CFC7` | Warm border |

### Colors: Semantic
| Token | Maps To | Description |
|-------|---------|-------------|
| `--color-primary` | `--color-terracotta` | Primary action color |
| `--color-primary-hover` | `#B54E30` | Hover state |
| `--color-secondary` | `--color-sage` | Secondary action |
| `--color-success` | `--color-sage` | Success state |
| `--color-warning` | `#D4A853` | Warning state |
| `--color-error` | `--color-terracotta` | Error state |
| `--color-info` | `#5B8FB9` | Info state |

### Colors: Surface
| Token | Default | Description |
|-------|---------|-------------|
| `--color-surface` | `#FFFFFF` | Card/panel surface |
| `--color-surface-raised` | `#FAFAF7` | Elevated surface |
| `--color-background` | `--color-parchment` | Page background |
| `--color-background-alt` | `--color-cream` | Alternate bg |

### Typography
| Token | Values | Description |
|-------|--------|-------------|
| `--font-serif` | Newsreader, Georgia... | Serif headings |
| `--font-sans` | Inter, system-ui... | Sans body |
| `--font-mono` | JetBrains Mono... | Code/mono |
| `--text-xs` | `0.75rem` | 12px |
| `--text-sm` | `0.875rem` | 14px |
| `--text-base` | `1rem` | 16px |
| `--text-lg` | `1.125rem` | 18px |
| `--text-xl` | `1.25rem` | 20px |
| `--text-2xl` | `1.5rem` | 24px |
| `--text-3xl` | `2rem` | 32px |
| `--text-4xl` | `2.5rem` | 40px |
| `--leading-tight` | `1.25` | Tight line height |
| `--leading-normal` | `1.5` | Normal line height |
| `--leading-relaxed` | `1.75` | Relaxed line height |
| `--weight-normal` | `400` | |
| `--weight-medium` | `500` | |
| `--weight-semibold` | `600` | |
| `--weight-bold` | `700` | |

### Spacing (4px base)
| Token | Value |
|-------|-------|
| `--space-0` | `0` |
| `--space-1` | `0.25rem` (4px) |
| `--space-2` | `0.5rem` (8px) |
| `--space-3` | `0.75rem` (12px) |
| `--space-4` | `1rem` (16px) |
| `--space-5` | `1.25rem` (20px) |
| `--space-6` | `1.5rem` (24px) |
| `--space-8` | `2rem` (32px) |
| `--space-10` | `2.5rem` (40px) |
| `--space-12` | `3rem` (48px) |

### Border Radius
| Token | Value |
|-------|-------|
| `--radius-sm` | `4px` |
| `--radius-md` | `8px` |
| `--radius-lg` | `12px` |
| `--radius-xl` | `16px` |
| `--radius-pill` | `9999px` |
| `--radius-full` | `50%` |

### Shadows
| Token | Description |
|-------|-------------|
| `--shadow-sm` | Subtle lift |
| `--shadow-md` | Card shadow |
| `--shadow-lg` | Dropdown/modal |
| `--shadow-xl` | Heavy overlay |
| `--shadow-inset` | Input fields |

### Transitions
| Token | Value |
|-------|-------|
| `--transition-fast` | `150ms ease` |
| `--transition-normal` | `250ms ease` |
| `--transition-slow` | `350ms ease` |

### Layout
| Token | Value |
|-------|-------|
| `--sidebar-width` | `220px` |
| `--sidebar-collapsed-width` | `48px` |
| `--statusbar-height` | `28px` |
| `--input-min-height` | `48px` |

## Theming

Themes are applied via the `data-theme` attribute on any ancestor element:

```html
<!-- Dark mode -->
<body data-theme="dark">

<!-- Earth tone -->
<body data-theme="earth">
```

Theme files define overrides for the relevant tokens. Only tokens that change per-theme are redefined — all others inherit from `:root`.
