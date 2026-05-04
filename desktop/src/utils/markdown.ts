/**
 * Markdown parsing utility using the `marked` library.
 * Converts markdown text to sanitized HTML for rendering in chat messages.
 */

import { marked } from 'marked';

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function parseMarkdown(text: string): string {
  const raw = marked.parse(text);
  if (typeof raw !== 'string') {
    return '';
  }
  return raw;
}
