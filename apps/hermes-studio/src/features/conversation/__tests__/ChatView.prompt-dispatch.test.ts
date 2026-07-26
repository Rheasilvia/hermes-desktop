import { describe, expect, it } from 'vitest';
import { buildPlanExecutionContext, resolvePromptDispatch } from '../ChatView';

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

  it('routes attachment reference text into turn-scoped context', () => {
    expect(resolvePromptDispatch(
      'Summarize this file',
      'Summarize this file',
      undefined,
      '@file:docs/mydoc.txt',
    )).toEqual({
      message: 'Summarize this file',
      context: '@file:docs/mydoc.txt',
    });
  });

  it('keeps execute-plan user text short while carrying the full plan in context', () => {
    expect(resolvePromptDispatch(
      'Implement this plan.',
      'Implement this plan.',
      { text: 'Implement this plan.' },
      buildPlanExecutionContext('# Plan\n\n- Build it'),
    )).toEqual({
      message: 'Implement this plan.',
      context: 'Approved plan:\n\n# Plan\n\n- Build it',
    });
  });
});
