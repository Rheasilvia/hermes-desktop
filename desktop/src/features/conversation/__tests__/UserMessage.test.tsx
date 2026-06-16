import { render, screen } from '@solidjs/testing-library';
import { describe, test, expect } from 'vitest';
import { UserMessage } from '../UserMessage.js';

describe('UserMessage', () => {
  test('renders plain content when not a slash command', () => {
    render(() => <UserMessage content="hello world" />);
    expect(screen.getByText('hello world')).toBeDefined();
  });

  test('renders the command label + args (not the expanded content) for a slash command', () => {
    // `content` simulates the huge expanded skill prompt that the LLM received.
    render(() => (
      <UserMessage
        content="[IMPORTANT: the user invoked the arxiv skill] --- name: arxiv ... (huge dump)"
        slashCommand={{ command: 'arxiv', args: '这是什么命令？' }}
      />
    ));
    // Shows the compact command + the typed args.
    expect(screen.getByText('/arxiv')).toBeDefined();
    expect(screen.getByText('这是什么命令？')).toBeDefined();
    // Does NOT leak the expanded prompt into the bubble.
    expect(screen.queryByText(/huge dump/)).toBeNull();
  });

  test('renders just the command label when there are no args', () => {
    render(() => (
      <UserMessage content="/status" slashCommand={{ command: 'status', args: '' }} />
    ));
    expect(screen.getByText('/status')).toBeDefined();
  });

  test('renders ordered inline file display parts inside the user bubble', () => {
    render(() => (
      <UserMessage
        content="[File 1: one.ts:L1-L3] first [File 2: two.ts] second"
        displayParts={[
          { type: 'file_ref', refText: '@file:docs/one.ts:1-3', name: 'one.ts', detail: 'docs/one.ts:1-3', anchor: 'File 1', lineStart: 1, lineEnd: 3 },
          { type: 'text', text: ' first ' },
          { type: 'file_ref', refText: '@file:src/two.ts', name: 'two.ts', detail: 'src/two.ts', anchor: 'File 2' },
          { type: 'text', text: ' second' },
        ]}
      />
    ));

    expect(screen.getByText('one.ts:L1-L3')).toBeDefined();
    expect(screen.getByText('two.ts')).toBeDefined();
    expect(screen.getByText('first')).toBeDefined();
    expect(screen.getByText('second')).toBeDefined();
    expect(screen.queryByText('[File 1: one.ts:L1-L3] first [File 2: two.ts] second')).toBeNull();
  });

  test('renders image attachments as thumbnails in the user bubble', () => {
    render(() => (
      <UserMessage
        content="check this"
        attachments={[
          { id: 'img1', kind: 'image', name: 'screenshot.png', path: '/tmp/clip-1.png' },
          { id: 'file1', kind: 'file', name: 'note.md', path: '/tmp/note.md' },
        ]}
      />
    ));

    // An image attachment renders the image gallery group (always present,
    // even before the <img> load event fires in jsdom). Non-image chips are
    // NOT rendered into the gallery.
    const gallery = document.querySelector('[aria-label="Attached images"]');
    expect(gallery).not.toBeNull();
    // The gallery preloads the image; its <img> src carries the (unconverted,
    // since jsdom is not Tauri) attachment path.
    const imgs = gallery?.querySelectorAll('img') ?? [];
    expect(imgs.length).toBeGreaterThan(0);
    expect(Array.from(imgs).some((img) => (img.getAttribute('src') ?? '').includes('clip-1.png'))).toBe(true);
  });
});
