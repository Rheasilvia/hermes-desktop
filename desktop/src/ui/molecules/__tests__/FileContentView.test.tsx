import { render, fireEvent, screen } from '@solidjs/testing-library';
import { describe, test, expect } from 'vitest';
import { FileContentView } from '../FileContentView.js';

describe('FileContentView', () => {
  test('renders binary placeholder when binary=true', () => {
    render(() => <FileContentView content={null} binary filename="x.png" />);
    expect(screen.getByText(/Binary file/i)).toBeDefined();
  });

  test('renders empty state when content is null and not binary', () => {
    render(() => <FileContentView content={null} filename="x.md" />);
    expect(screen.getByText(/Empty file/i)).toBeDefined();
  });

  test('renders parsed markdown for .md files in preview mode', () => {
    const { container } = render(() => (
      <FileContentView content="# Hello" filename="x.md" />
    ));
    expect(container.querySelector('h1')).not.toBeNull();
    expect(container.querySelector('h1')!.textContent).toContain('Hello');
  });

  test('shows Preview/Source toggle for .md when showSourceToggle=true (default)', () => {
    render(() => <FileContentView content="# Hello" filename="x.md" />);
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeDefined();
    expect(screen.getByRole('tab', { name: 'Source' })).toBeDefined();
  });

  test('hides toggle when showSourceToggle=false (memory case)', () => {
    render(() => (
      <FileContentView
        content="# Hello"
        filename="x.md"
        showSourceToggle={false}
      />
    ));
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Source' })).toBeNull();
  });

  test('clicking Source switches away from rendered markdown', () => {
    const { container } = render(() => (
      <FileContentView content="# Hello" filename="x.md" />
    ));
    expect(container.querySelector('h1')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Source' }));
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
  });

  test('non-markdown files render no toggle and no markdown HTML', () => {
    const { container } = render(() => (
      <FileContentView content={'const a = 1;'} filename="x.ts" />
    ));
    expect(screen.queryByRole('tab', { name: 'Preview' })).toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
  });

  test('shows banner when provided', () => {
    render(() => (
      <FileContentView
        content="text"
        filename="x.md"
        banner="Showing first 100 KB of 250 KB"
      />
    ));
    expect(screen.getByText(/Showing first 100 KB/)).toBeDefined();
  });

  test('renders heading hierarchy h1/h2/h3 in markdown preview', () => {
    const { container } = render(() => (
      <FileContentView
        content={'# Title\n\n## Section\n\n### Subsection\n\nbody'}
        filename="doc.md"
      />
    ));
    const h1 = container.querySelector('h1');
    const h2 = container.querySelector('h2');
    const h3 = container.querySelector('h3');
    expect(h1?.textContent).toContain('Title');
    expect(h2?.textContent).toContain('Section');
    expect(h3?.textContent).toContain('Subsection');
  });

  test('renders fenced code block with language class for highlighter hookup', () => {
    const md = '```ts\nconst a: number = 1;\n```\n';
    const { container } = render(() => (
      <FileContentView content={md} filename="doc.md" />
    ));
    const code = container.querySelector('pre > code');
    expect(code).not.toBeNull();
    // marked emits language-<id>; sanitizeHtml preserves the `class` attribute.
    const cls = code!.getAttribute('class') ?? '';
    expect(cls).toMatch(/language-/);
  });

  test('renders inline code outside <pre>', () => {
    const { container } = render(() => (
      <FileContentView content="use the `value` field" filename="doc.md" />
    ));
    const inlineCode = container.querySelector('p > code');
    expect(inlineCode).not.toBeNull();
    expect(inlineCode!.textContent).toBe('value');
    // Inline code must not be wrapped in a <pre>.
    expect(inlineCode!.closest('pre')).toBeNull();
  });

  test('renders task list with checkboxes', () => {
    const md = '- [ ] todo\n- [x] done\n';
    const { container } = render(() => (
      <FileContentView content={md} filename="doc.md" />
    ));
    const checkboxes = container.querySelectorAll('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
  });

  test('renders table with header and body cells', () => {
    const md = '| h1 | h2 |\n|----|----|\n| a  | b  |\n';
    const { container } = render(() => (
      <FileContentView content={md} filename="doc.md" />
    ));
    expect(container.querySelector('table thead th')).not.toBeNull();
    expect(container.querySelector('table tbody td')).not.toBeNull();
  });
});
