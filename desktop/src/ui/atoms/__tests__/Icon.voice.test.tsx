import { render } from '@solidjs/testing-library';
import { describe, expect, test } from 'vitest';
import { Icon } from '../Icon.js';

describe('Icon voice names', () => {
  test.each(['mic', 'volume-2', 'volume-x'] as const)('renders %s', (name) => {
    const { container } = render(() => <Icon name={name} />);

    expect(container.querySelector('svg')).not.toBeNull();
  });
});
