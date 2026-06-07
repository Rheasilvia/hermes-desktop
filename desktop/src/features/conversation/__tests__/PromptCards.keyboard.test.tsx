import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi } from 'vitest';
import { ClarificationCard } from '../ClarificationCard.js';
import { PermissionRequestCard } from '../turn/PermissionRequestCard.js';
import type { PendingPermission } from '@/types/ui/turn.js';

describe('prompt card keyboard handling', () => {
  test('clarification Enter does nothing before a choice is selected', () => {
    const onRespond = vi.fn();
    render(() => (
      <ClarificationCard
        question="Pick one"
        choices={['Alpha', 'Beta']}
        onRespond={onRespond}
      />
    ));

    fireEvent.keyDown(screen.getByRole('group', { name: 'Pick one' }), { key: 'Enter' });

    expect(onRespond).not.toHaveBeenCalled();
  });

  test('clarification ArrowDown then Enter submits the selected choice', () => {
    const onRespond = vi.fn();
    render(() => (
      <ClarificationCard
        question="Pick one"
        choices={['Alpha', 'Beta']}
        onRespond={onRespond}
      />
    ));

    const group = screen.getByRole('group', { name: 'Pick one' });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    fireEvent.keyDown(group, { key: 'Enter' });

    expect(onRespond).toHaveBeenCalledWith('Alpha');
  });

  test('clarification free-text Enter submits typed text and keeps arrows native', () => {
    const onRespond = vi.fn();
    render(() => (
      <ClarificationCard
        question="Pick one"
        choices={['Alpha', 'Beta']}
        onRespond={onRespond}
      />
    ));

    const input = screen.getByPlaceholderText('Or type your answer…') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'typed answer' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onRespond).toHaveBeenCalledWith('typed answer');
  });

  test('approval Enter does nothing before an action is selected', () => {
    const onApprovalChoice = vi.fn();
    render(() => (
      <PermissionRequestCard
        permission={approvalPermission()}
        onApprovalChoice={onApprovalChoice}
        onMaskedSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    fireEvent.keyDown(screen.getByRole('group', { name: 'Waiting for approval' }), { key: 'Enter' });

    expect(onApprovalChoice).not.toHaveBeenCalled();
  });

  test('approval ArrowDown then Enter activates the selected action', () => {
    const onApprovalChoice = vi.fn();
    render(() => (
      <PermissionRequestCard
        permission={approvalPermission()}
        onApprovalChoice={onApprovalChoice}
        onMaskedSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    ));

    const group = screen.getByRole('group', { name: 'Waiting for approval' });
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    fireEvent.keyDown(group, { key: 'Enter' });

    expect(onApprovalChoice).toHaveBeenCalledWith('deny');
  });

  test('masked inputs keep arrow keys and submit behavior local', () => {
    const onMaskedSubmit = vi.fn();
    render(() => (
      <PermissionRequestCard
        permission={{ ...approvalPermission(), kind: 'secret', requestId: 'secret-1' }}
        onApprovalChoice={vi.fn()}
        onMaskedSubmit={onMaskedSubmit}
        onCancel={vi.fn()}
      />
    ));

    const input = screen.getByPlaceholderText('Value') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'token' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.submit(input.closest('form')!);

    expect(onMaskedSubmit).toHaveBeenCalledWith('secret-1', 'token');
  });
});

function approvalPermission(): PendingPermission {
  return {
    kind: 'approval',
    command: 'rm -rf tmp',
    description: 'Needs approval',
    isPathApproval: true,
  };
}
