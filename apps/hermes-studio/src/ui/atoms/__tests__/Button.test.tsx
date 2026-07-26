import { render, fireEvent, screen } from '@solidjs/testing-library';
import { describe, test, expect } from 'vitest';
import { createSignal } from 'solid-js';

const TestButton = (props: { onClick?: () => void; disabled?: boolean }) => (
  <button onClick={props.onClick} disabled={props.disabled}>Click me</button>
);

describe('Button Component (Vitest + SolidJS Setup Verification)', () => {
  test('renders a button', () => {
    const { container } = render(() => <TestButton />);
    expect(container.querySelector('button')).not.toBeNull();
  });

  test('button displays correct text', () => {
    render(() => <TestButton />);
    expect(screen.getByText('Click me')).toBeDefined();
  });

  test('button calls onClick when clicked', () => {
    const [clicked, setClicked] = createSignal(false);
    render(() => <TestButton onClick={() => setClicked(true)} />);
    fireEvent.click(screen.getByText('Click me'));
    expect(clicked()).toBe(true);
  });

  test('button is disabled when disabled prop is true', () => {
    render(() => <TestButton disabled={true} />);
    expect((screen.getByText('Click me') as HTMLButtonElement).disabled).toBe(true);
  });
});
