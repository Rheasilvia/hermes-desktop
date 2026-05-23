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

import { Renderer, marked } from 'marked';
import DOMPurify from 'dompurify';
import { createHighlighter, type Highlighter } from 'shiki';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';

// ── Custom Renderer ─────────────────────────────────────────────────────

const renderer = new Renderer();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origLink = renderer.link.bind(renderer) as (token: any) => string;
renderer.link = function (token) {
  let html = origLink(token);
  if (token.href && /^https?:\/\//.test(token.href)) {
    html = html.replace(/^<a /, '<a target="_blank" rel="noopener noreferrer" ');
  }
  return html;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origImage = renderer.image.bind(renderer) as (token: any) => string;
renderer.image = function (token) {
  let html = origImage(token);
  html = html.replace(/^<img /, '<img loading="lazy" referrerpolicy="no-referrer" ');
  return html;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const origTable = renderer.table.bind(renderer) as (token: any) => string;
renderer.table = function (token) {
  const html = origTable(token);
  return `<div class="markdown-table-wrapper">${html}</div>`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Public API ───────────────────────────────────────────────────────────

const EMPTY = '';

export function parseMarkdown(text: string): string {
  if (!text) return EMPTY;
  const raw = marked.parse(text);
  if (typeof raw !== 'string') return EMPTY;
  return sanitizeHtml(raw.trim());
}
