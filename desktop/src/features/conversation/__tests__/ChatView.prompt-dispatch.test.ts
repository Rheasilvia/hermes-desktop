import { describe, expect, it } from 'vitest';
import { resolvePromptDispatch } from '../ChatView';

describe('resolvePromptDispatch', () => {
  it('sends slash command display text while injecting expanded prompt as context', () => {
    expect(resolvePromptDispatch(
      'expanded skill prompt',
      '/arxiv transformers',
      { text: '/arxiv transformers', slashCommand: { command: 'arxiv', args: 'transformers' } },
    )).toEqual({
      message: '/arxiv transformers',
      context: 'expanded skill prompt',
      slashCommand: { command: 'arxiv', args: 'transformers' },
    });
  });

  it('keeps normal @ references in the user message', () => {
    expect(resolvePromptDispatch(
      'summarize @src/main.ts',
      'summarize @src/main.ts',
    )).toEqual({
      message: 'summarize @src/main.ts',
    });
  });

  it('keeps attachment reference text in the user message instead of context', () => {
    expect(resolvePromptDispatch(
      '@image:screenshot.png\n\nWhat do you see?',
      'screenshot.png',
      { text: 'screenshot.png' },
    )).toEqual({
      message: '@image:screenshot.png\n\nWhat do you see?',
    });
  });
});
