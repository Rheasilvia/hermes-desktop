/**
 * Markdown parsing utility using the `marked` library.
 * Converts markdown text to polished HTML for rendering in chat messages.
 *
 * Custom renderer enhancements over default marked:
 * - External links: target="_blank" + rel="noopener noreferrer"
 * - Images: loading="lazy" + referrerpolicy="no-referrer"
 * - Tables: wrapped in responsive scroll container
 * - Checkboxes: explicit disabled attribute
 *
 * NOTE: @types/marked v5 types are behind marked v18 runtime.
 * Renderer method overrides use `any` tokens to bridge the gap.
 */

import { Renderer, marked } from 'marked';

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

// ── Public API ───────────────────────────────────────────────────────────

const EMPTY = '';

export function parseMarkdown(text: string): string {
  if (!text) return EMPTY;
  const raw = marked.parse(text);
  if (typeof raw !== 'string') return EMPTY;
  return raw;
}
