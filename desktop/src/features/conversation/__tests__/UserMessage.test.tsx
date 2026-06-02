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
});
