import { render, screen } from '@solidjs/testing-library';
import { describe, expect, test } from 'vitest';

import { PromptDock } from '../turn/PromptDock.js';

describe('PromptDock', () => {
  test('defaults items to full-width placement', () => {
    render(() => <PromptDock items={[{ id: 'full', content: <span>Full item</span> }]} />);

    const item = screen.getByText('Full item').parentElement;

    expect(item?.dataset.placement).toBe('full');
    expect(item?.className).not.toContain('itemCompactCenter');
  });

  test('marks compact-center items for centered compact layout', () => {
    render(() => (
      <PromptDock
        items={[{ id: 'todo', placement: 'compact-center', content: <span>Compact item</span> }]}
      />
    ));

    const item = screen.getByText('Compact item').parentElement;

    expect(item?.dataset.placement).toBe('compact-center');
    expect(item?.className).toContain('itemCompactCenter');
  });
});
