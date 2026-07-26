import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, test, expect, vi } from 'vitest';
import { CardList, CardRow } from '../CardList.js';

describe('CardList archetype', () => {
  test('renders the empty state when there are no items', () => {
    render(() => <CardList state={{ items: [] }} empty="Nothing here.">{() => null}</CardList>);
    expect(screen.getByText('Nothing here.')).toBeDefined();
  });

  test('renders the error state with a retry button', () => {
    const onRetry = vi.fn();
    render(() => (
      <CardList state={{ items: [], error: 'Boom' }} empty="x" onRetry={onRetry}>
        {() => null}
      </CardList>
    ));
    expect(screen.getByText('Boom')).toBeDefined();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test('renders a row per item', () => {
    render(() => (
      <CardList state={{ items: ['a', 'b'] }} empty="x">
        {(item) => <CardRow>{item}</CardRow>}
      </CardList>
    ));
    expect(screen.getByText('a')).toBeDefined();
    expect(screen.getByText('b')).toBeDefined();
  });
});

describe('CardRow', () => {
  test('primary activate fires; trailing action stops propagation', () => {
    const onActivate = vi.fn();
    const onTrailing = vi.fn();
    render(() => (
      <CardRow
        onActivate={onActivate}
        trailing={<button type="button" aria-label="del" onClick={(e) => { e.stopPropagation(); onTrailing(); }}>x</button>}
      >
        Row label
      </CardRow>
    ));

    fireEvent.click(screen.getByText('Row label'));
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'del' }));
    expect(onTrailing).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledTimes(1); // not re-fired by the trailing click
  });

  test('a row with no onActivate is not a button', () => {
    render(() => <CardRow>Static</CardRow>);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
