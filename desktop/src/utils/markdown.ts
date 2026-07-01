/**
 * Markdown parsing utility using the `marked` library.
 * Converts markdown text to sanitized, polished HTML for rendering in chat messages.
 *
 * Custom renderer enhancements over default marked:
 * - External links: target="_blank" + rel="noopener noreferrer"
 * - Images: loading="lazy" + referrerpolicy="no-referrer"
 * - Tables: wrapped in responsive scroll container
 * - Checkboxes: explicit disabled attribute
 *
 * Phase 2 adds:
 * - DOMPurify HTML sanitization (XSS prevention)
 * - Shiki syntax highlighting (VS Code engine, JS regex backend)
 *
 * NOTE: @types/marked v5 types are behind marked v18 runtime.
 * Renderer method overrides use `any` tokens to bridge the gap.
 */

import { Marked, Renderer, marked } from 'marked';
import DOMPurify from 'dompurify';
import { createHighlighter, type Highlighter } from 'shiki';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import renderMathInElement from 'katex/contrib/auto-render';
import 'katex/dist/katex.min.css';

// ── Custom Renderer ─────────────────────────────────────────────────────

const renderer = new Renderer();

const origLink = renderer.link.bind(renderer) as (token: any) => string;
renderer.link = function (token) {
  let html = origLink(token);
  if (token.href && /^https?:\/\//.test(token.href)) {
    html = html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  }
  return html;
};

const origImage = renderer.image.bind(renderer) as (token: any) => string;
renderer.image = function (token) {
  let html = origImage(token);
  html = html.replace(/^<img /, '<img loading="lazy" referrerpolicy="no-referrer" ');
  return html;
};

const origTable = renderer.table.bind(renderer) as (token: any) => string;
renderer.table = function (token) {
  const html = origTable(token);
  return `<div class="markdown-table-wrapper">${html}</div>`;
};

const origCheckbox = renderer.checkbox.bind(renderer) as (token: any) => string;
renderer.checkbox = function (token) {
  const html = origCheckbox(token);
  if (!html.includes('disabled')) {
    return html.replace(/^<input /, '<input disabled ');
  }
  return html;
};

marked.setOptions({
  renderer,
  breaks: true,
  gfm: true,
});

// ── HTML Sanitization ────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  'p', 'a', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'strong', 'b', 'em', 'i', 'del', 's', 'u', 'ins',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th',
  'hr', 'br', 'img', 'input',
  'span', 'div', 'sup', 'sub', 'mark', 'details', 'summary',
  'kbd', 'small',
];

const ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel',
  'src', 'alt', 'loading', 'referrerpolicy',
  'type', 'disabled', 'checked',
  'class',
  'colspan', 'rowspan',
];

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
  });
}

// ── Math (KaTeX) ───────────────────────────────────────────────────────────

// $$…$$ / \[…\] before $…$ so display math matches before inline.
const MATH_DELIMITERS = [
  { left: '$$', right: '$$', display: true },
  { left: '\\[', right: '\\]', display: true },
  { left: '\\(', right: '\\)', display: false },
  { left: '$', right: '$', display: false },
];

/**
 * Render LaTeX math (KaTeX) in place on already-rendered, already-in-DOM content.
 * MUST run post-sanitize: DOMPurify's allowlist has no MathML/`style`, so piping
 * KaTeX output through `sanitizeHtml` would strip it — this mirrors how
 * `highlightCodeBlocksIn` post-processes the live DOM. KaTeX's default `trust: false`
 * keeps it safe on untrusted input; `pre`/`code` are ignored so shell snippets with
 * `$` are left alone.
 */
export function renderMathIn(root: HTMLElement): void {
  try {
    renderMathInElement(root, {
      delimiters: MATH_DELIMITERS,
      throwOnError: false,
      errorColor: 'var(--color-danger, #c0392b)',
      ignoredTags: ['script', 'style', 'textarea', 'pre', 'code'],
    });
  } catch {
    // Best-effort; leave raw text if KaTeX fails.
  }
}

// ── Math tokenization (marked extension) ─────────────────────────────────────
//
// Capture $…$ / $$…$$ / \(…\) / \[…\] as ATOMIC tokens BEFORE marked's inline
// lexer runs. Otherwise markdown corrupts the LaTeX: newlines in a multi-line
// $$…$$ become <br> and paired underscores become <em>, splitting the delimiters
// across separate text nodes — and renderMathIn() matches delimiters only WITHIN
// a single text node, so it silently skips the block. We re-emit the RAW latex
// (escaped, delimiters kept) inside a sanitize-safe wrapper; the existing
// renderMathIn() pass then renders it on the live DOM post-sanitize (KaTeX HTML
// can't survive DOMPurify's allowlist, which is why we don't render at parse time).

// Ordered display-first so $$…$$ / \[…\] win before $…$ / \(…\).
const INLINE_MATH_PATTERNS = [
  /^\$\$([^\n]+?)\$\$/, // $$…$$ on one line (display)
  /^\\\[([\s\S]+?)\\\]/, // \[…\] (display)
  /^\$([^\n$]+?)\$/, // $…$ (inline)
  /^\\\(([\s\S]+?)\\\)/, // \(…\) (inline)
];

const mathExtension = {
  extensions: [
    {
      name: 'blockMath',
      level: 'block' as const,
      start(src: string) {
        const i = src.indexOf('$$');
        return i < 0 ? undefined : i;
      },
      tokenizer(src: string) {
        const m = /^\$\$([\s\S]+?)\$\$/.exec(src);
        if (!m) return undefined;
        return { type: 'blockMath', raw: m[0], text: m[1] };
      },
      renderer(token: any) {
        return `<div class="katex-block">${escapeHtml(token.raw)}</div>\n`;
      },
    },
    {
      name: 'inlineMath',
      level: 'inline' as const,
      start(src: string) {
        const m = /\$|\\[([]/.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        for (const re of INLINE_MATH_PATTERNS) {
          const m = re.exec(src);
          if (m) return { type: 'inlineMath', raw: m[0], text: m[1] };
        }
        return undefined;
      },
      renderer(token: any) {
        return `<span class="katex-inline">${escapeHtml(token.raw)}</span>`;
      },
    },
  ],
};

// Dedicated instance so the global `marked` (chat / file preview) stays untouched
// — math is notebook-only. Shared `renderer` is safe: parsing is synchronous.
const mathMarked = new Marked();
mathMarked.setOptions({ renderer, breaks: true, gfm: true });
mathMarked.use(mathExtension);

// ── Code Highlighting (Shiki) ────────────────────────────────────────────

const SHIKI_LANGS = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'sql',
  'css', 'html', 'markdown', 'rust', 'go', 'java', 'yaml',
];

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  rs: 'rust',
  yml: 'yaml',
  md: 'markdown',
};

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ['dark-plus'],
      langs: SHIKI_LANGS,
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

/** Extract inner HTML from Shiki's `<pre><code>...</code></pre>` output. */
function extractCodeInner(shikiHtml: string): string {
  const m = shikiHtml.match(/<code[^>]*>([\s\S]*)<\/code>/);
  return m ? m[1] : escapeHtml('');
}

export async function highlightCode(code: string, language: string | null): Promise<string> {
  if (!language || !code.trim()) {
    return escapeHtml(code);
  }

  const alias = language.toLowerCase().trim();
  const lang = LANG_ALIASES[alias] ?? alias;

  try {
    const h = await getHighlighter();
    if (!SHIKI_LANGS.includes(lang) && !LANG_ALIASES[lang]) {
      return escapeHtml(code);
    }
    const result = h.codeToHtml(code, { lang, theme: 'dark-plus' });
    return extractCodeInner(result);
  } catch {
    return escapeHtml(code);
  }
}

/**
 * Post-process a rendered markdown container: replace the inner HTML of every
 * `<pre><code class="language-xxx">` with the syntax-highlighted version. Each
 * code block is processed independently; one failure does not affect others.
 */
export async function highlightCodeBlocksIn(root: HTMLElement): Promise<void> {
  const blocks = root.querySelectorAll<HTMLElement>(
    'pre > code[class*="language-"]',
  );
  for (const code of Array.from(blocks)) {
    const langClass = Array.from(code.classList).find((c) =>
      c.startsWith('language-'),
    );
    if (!langClass) continue;
    const lang = langClass.slice('language-'.length);
    const text = code.textContent ?? '';
    if (!text) continue;
    try {
      const html = await highlightCode(text, lang);
      code.innerHTML = html;
    } catch {
      // Leave the original (already escaped by marked) content in place.
    }
  }
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Filename → language inference ────────────────────────────────────────

/** Filename extension → highlight language map. Single source of truth shared
 *  by FileContentView, WorkspaceFilePreview, and any future caller. */
export const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash',
  json: 'json', jsonc: 'json',
  sql: 'sql',
  css: 'css', scss: 'css', sass: 'css',
  html: 'html', htm: 'html', svelte: 'html', vue: 'html',
  md: 'markdown', mdx: 'markdown',
  rs: 'rust',
  go: 'go',
  java: 'java',
  yaml: 'yaml', yml: 'yaml',
};

/** Infer highlight language from a filename. Returns `null` for files with no
 *  recognized extension. Case-insensitive. */
export function langFromName(filename: string): string | null {
  if (!filename || !filename.includes('.')) return null;
  const ext = filename.split('.').pop()!.toLowerCase();
  return EXT_TO_LANG[ext] ?? null;
}

// ── Public API ───────────────────────────────────────────────────────────

const EMPTY = '';

export function parseMarkdown(text: string, opts?: { math?: boolean }): string {
  if (!text) return EMPTY;
  // Route through the math-aware instance only when math is opted-in AND the
  // text actually contains a delimiter; everything else uses the identical
  // global `marked` path, so plain markdown renders the same in chat & notebook.
  const parser = opts?.math && /\$|\\[([]/.test(text) ? mathMarked : marked;
  const raw = parser.parse(text);
  if (typeof raw !== 'string') return EMPTY;
  return sanitizeHtml(raw.trim());
}
