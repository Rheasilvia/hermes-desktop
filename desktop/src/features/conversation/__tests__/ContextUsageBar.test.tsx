import { render, screen } from '@solidjs/testing-library';
import { describe, expect, test } from 'vitest';
import { ContextUsageBar } from '../ContextUsageBar.js';

describe('ContextUsageBar', () => {
  test('shows zero tokens when usage is unavailable', () => {
    render(() => (
      <ContextUsageBar
        contextUsed={null}
        contextMax={null}
        contextPercent={null}
        costUsd={null}
        totalTokens={null}
      />
    ));

    expect(screen.getByText('0 tokens')).toBeDefined();
  });

  test('shows total token usage when context usage is unavailable', () => {
    render(() => (
      <ContextUsageBar
        contextUsed={null}
        contextMax={null}
        contextPercent={null}
        costUsd={null}
        totalTokens={1234}
      />
    ));

    expect(screen.getByText('1.2k tokens')).toBeDefined();
  });

  test('shows context usage as numbers without a progress bar', () => {
    const { container } = render(() => (
      <ContextUsageBar
        contextUsed={8400}
        contextMax={200000}
        contextPercent={4}
        costUsd={0.42}
        totalTokens={1234}
      />
    ));

    expect(screen.getByText('1.2k tokens')).toBeDefined();
    expect(screen.getByText('8.4k / 200k context')).toBeDefined();
    expect(container.querySelector('[style*="width"]')).toBeNull();
  });
});
