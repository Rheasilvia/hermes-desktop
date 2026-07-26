import { fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type Component } from 'solid-js';
import { describe, expect, it } from 'vitest';
import { ModuleErrorBoundary } from '../ModuleErrorBoundary.js';

describe('ModuleErrorBoundary', () => {
  it('renders a recovery fallback and resets the failed module on retry', async () => {
    const [shouldThrow, setShouldThrow] = createSignal(true);
    const FailingChild: Component = () => {
      if (shouldThrow()) throw new Error('boom');
      return <div>Recovered module</div>;
    };

    render(() => (
      <ModuleErrorBoundary moduleName="Conversation">
        <FailingChild />
      </ModuleErrorBoundary>
    ));

    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(screen.getByText('The Conversation module encountered an error.')).toBeTruthy();

    setShouldThrow(false);
    await fireEvent.click(screen.getByText('Try again'));

    expect(screen.getByText('Recovered module')).toBeTruthy();
  });
});
