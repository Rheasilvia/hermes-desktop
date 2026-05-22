import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, test, expect, vi } from 'vitest';
import { JumpToBottom } from '../JumpToBottom.js';

describe('JumpToBottom', () => {
  test('renders when visible', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={0} visible={true} onClick={onClick} />
    ));

    expect(screen.getByRole('button', { name: 'Jump to bottom' })).toBeDefined();
  });

  test('does not render when not visible', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={0} visible={false} onClick={onClick} />
    ));

    expect(screen.queryByRole('button', { name: 'Jump to bottom' })).toBeNull();
  });

  test('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={0} visible={true} onClick={onClick} />
    ));

    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('shows badge with unread count', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={5} visible={true} onClick={onClick} />
    ));

    expect(screen.getByText('5 new')).toBeDefined();
  });

  test('shows 99+ new when unread count exceeds 99', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={150} visible={true} onClick={onClick} />
    ));

    expect(screen.getByText('99+ new')).toBeDefined();
  });

  test('does not show badge when unread count is 0', () => {
    const onClick = vi.fn();
    render(() => (
      <JumpToBottom unreadCount={0} visible={true} onClick={onClick} />
    ));

    expect(screen.queryByText('0 new')).toBeNull();
  });
});
