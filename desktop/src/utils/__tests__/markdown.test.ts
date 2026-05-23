import { describe, it, expect } from 'vitest';
import { parseMarkdown, sanitizeHtml, highlightCode } from '../markdown.js';

describe('parseMarkdown', () => {
  it('returns empty string for empty input', () => {
    expect(parseMarkdown('')).toBe('');
  });

  it('renders paragraphs', () => {
    const result = parseMarkdown('hello world');
    expect(result).toContain('<p>hello world</p>');
  });

  it('renders headings h1-h6', () => {
    for (let i = 1; i <= 6; i++) {
      const prefix = '#'.repeat(i);
      const result = parseMarkdown(`${prefix} Heading ${i}`);
      expect(result).toContain(`<h${i}>`);
    }
  });

  it('renders bold and italic', () => {
    const result = parseMarkdown('**bold** *italic* ***both***');
    expect(result).toContain('<strong>bold</strong>');
    expect(result).toContain('<em>italic</em>');
  });

  it('renders strikethrough', () => {
    const result = parseMarkdown('~~deleted~~');
    expect(result).toContain('<del>deleted</del>');
  });

  it('renders unordered lists with ul/li', () => {
    const result = parseMarkdown('- item 1\n- item 2\n- item 3');
    expect(result).toContain('<ul>');
    expect(result).toMatch(/<li>item 1<\/li>/);
  });

  it('renders ordered lists with ol/li', () => {
    const result = parseMarkdown('1. first\n2. second');
    expect(result).toContain('<ol>');
    expect(result).toMatch(/<li>first<\/li>/);
  });

  it('renders nested lists', () => {
    const result = parseMarkdown('- a\n  - nested\n- b');
    const liCount = (result.match(/<li>/g) || []).length;
    expect(liCount).toBeGreaterThanOrEqual(2);
  });

  it('renders task lists with checkboxes', () => {
    const result = parseMarkdown('- [ ] todo\n- [x] done');
    expect(result).toContain('disabled');
    expect(result).toContain('type="checkbox"');
    expect(result).toContain('checked');
  });

  it('adds target="_blank" to external links', () => {
    const result = parseMarkdown('[example](https://example.com)');
    expect(result).toContain('target="_blank"');
    expect(result).toContain('rel="noopener noreferrer"');
  });

  it('does not add target to relative links', () => {
    const result = parseMarkdown('[local](/docs/readme)');
    expect(result).not.toContain('target="_blank"');
  });

  it('adds loading="lazy" to images', () => {
    const result = parseMarkdown('![alt](https://example.com/img.png)');
    expect(result).toContain('loading="lazy"');
    expect(result).toContain('referrerpolicy="no-referrer"');
  });

  it('renders blockquotes', () => {
    const result = parseMarkdown('> quoted text');
    expect(result).toContain('<blockquote>');
  });

  it('renders horizontal rules', () => {
    const result = parseMarkdown('---');
    expect(result).toContain('<hr>');
  });

  it('renders tables with wrapper', () => {
    const result = parseMarkdown('| a | b |\n|---|---|\n| 1 | 2 |');
    expect(result).toContain('markdown-table-wrapper');
    expect(result).toContain('<table>');
    expect(result).toContain('<th>a</th>');
  });
});

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const result = sanitizeHtml('<p>safe</p><script>alert("xss")</script>');
    expect(result).toContain('<p>safe</p>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert');
  });

  it('strips event handlers', () => {
    const result = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(result).not.toContain('onerror');
  });

  it('allows safe HTML tags', () => {
    const input = '<p>text</p><a href="https://x.com">link</a><ul><li>item</li></ul>';
    const result = sanitizeHtml(input);
    expect(result).toContain('<p>');
    expect(result).toContain('<a href="https://x.com">');
    expect(result).toContain('<ul>');
  });
});

describe('highlightCode', () => {
  it('returns escaped HTML for null language', async () => {
    const result = await highlightCode('const x = 1;', null);
    expect(result).toBe('const x = 1;');
  });

  it('returns empty string for empty code', async () => {
    const result = await highlightCode('', 'javascript');
    expect(result).toBe('');
  });

  it('highlights JavaScript with Shiki', async () => {
    const result = await highlightCode('const x = 1;', 'javascript');
    expect(result).toContain('style="');
  }, 15000);

  it('highlights Python with Shiki', async () => {
    const result = await highlightCode('print("hello")', 'python');
    expect(result).toContain('style="');
  }, 15000);

  it('handles language aliases', async () => {
    const result = await highlightCode('const x = 1;', 'ts');
    expect(result).toContain('style="');
  }, 15000);

  it('escapes HTML for unsupported language', async () => {
    const result = await highlightCode('some code', 'madeup-lang');
    expect(result).not.toContain('style="');
  }, 15000);
});
