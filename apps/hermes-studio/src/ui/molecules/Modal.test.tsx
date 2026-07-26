import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi } from 'vitest';
import { Modal } from './Modal.js';

describe('Modal', () => {
  test('renders the dialog through a body-level portal', () => {
    render(() => (
      <div data-testid="modal-host">
        <Modal open={true} title="Rename conversation" onClose={vi.fn()}>
          <input aria-label="Conversation name" />
        </Modal>
      </div>
    ));

    const host = screen.getByTestId('modal-host');
    const dialog = screen.getByRole('dialog');

    expect(document.body.contains(dialog)).toBe(true);
    expect(host.contains(dialog)).toBe(false);
  });

  test('preserves close interactions after portal mounting', () => {
    const onClose = vi.fn();
    render(() => (
      <Modal open={true} title="Rename conversation" onClose={onClose}>
        <input aria-label="Conversation name" />
      </Modal>
    ));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);

    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
