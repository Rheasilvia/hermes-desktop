import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import { PermissionModePicker } from '../PermissionModePicker.js';

describe('PermissionModePicker', () => {
  it('shows the current mode and exposes all permission choices', () => {
    render(() => (
      <PermissionModePicker
        mode="auto"
        onChange={vi.fn()}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Permission mode: Approve for me/ }));

    expect(screen.getByRole('menuitemradio', { name: /Ask for approval/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Approve for me/ })).toBeTruthy();
    expect(screen.getByRole('menuitemradio', { name: /Full file access/ })).toBeTruthy();
  });

  it('calls onChange only after the user selects a different mode', () => {
    const onChange = vi.fn();
    render(() => (
      <PermissionModePicker
        mode="auto"
        onChange={onChange}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Permission mode: Approve for me/ }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Full file access/ }));

    expect(onChange).toHaveBeenCalledWith('full');
  });

  it('disables the trigger while a permission update is pending', () => {
    render(() => (
      <PermissionModePicker
        mode="ask"
        pending
        onChange={vi.fn()}
      />
    ));

    expect(screen.getByRole('button', { name: /Permission mode: Ask for approval/ })).toHaveProperty('disabled', true);
  });

  it('uses a distinct visual state for full file access', () => {
    const { container } = render(() => (
      <PermissionModePicker
        mode="full"
        onChange={vi.fn()}
      />
    ));

    const trigger = screen.getByRole('button', { name: /Permission mode: Full file access/ });
    expect(trigger.className).toContain('permissionButtonFull');
    expect(container.textContent).toContain('Full file access');
  });

  it('does not truncate the current mode label in the trigger', () => {
    render(() => (
      <PermissionModePicker
        mode="full"
        onChange={vi.fn()}
      />
    ));

    const trigger = screen.getByRole('button', { name: /Permission mode: Full file access/ });
    const label = trigger.querySelector('[class*="permissionButtonLabel"]');

    expect(label?.textContent).toBe('Full file access');
    expect(label?.className).not.toContain('truncated');
  });

  it('uses the compact composer toolbar height', () => {
    render(() => (
      <PermissionModePicker
        mode="auto"
        onChange={vi.fn()}
      />
    ));

    const trigger = screen.getByRole('button', { name: /Permission mode: Approve for me/ });
    expect(trigger.className).toContain('permissionButton');
  });
});
