import { fireEvent, render, screen } from '@solidjs/testing-library';
import { describe, expect, test, vi } from 'vitest';
import { ClarificationCard } from '../ClarificationCard.js';
import { UserInputRequestCard } from '../UserInputRequestCard.js';
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

  test('clarification Escape submits an empty response', () => {
    const onRespond = vi.fn();
    render(() => (
      <ClarificationCard
        question="Pick one"
        choices={['Alpha', 'Beta']}
        onRespond={onRespond}
      />
    ));

    fireEvent.keyDown(screen.getByRole('group', { name: 'Pick one' }), { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledWith('');
  });

  test('clarification free-text Escape submits an empty response', () => {
    const onRespond = vi.fn();
    render(() => (
      <ClarificationCard
        question="Pick one"
        choices={['Alpha', 'Beta']}
        onRespond={onRespond}
      />
    ));

    fireEvent.keyDown(screen.getByPlaceholderText('Or type your answer…'), { key: 'Escape' });

    expect(onRespond).toHaveBeenCalledWith('');
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

  test('approval Escape cancels the prompt', () => {
    const onCancel = vi.fn();
    render(() => (
      <PermissionRequestCard
        permission={approvalPermission()}
        onApprovalChoice={vi.fn()}
        onMaskedSubmit={vi.fn()}
        onCancel={onCancel}
      />
    ));

    fireEvent.keyDown(screen.getByRole('group', { name: 'Waiting for approval' }), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
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

  test('masked input Escape cancels the prompt', () => {
    const onCancel = vi.fn();
    render(() => (
      <PermissionRequestCard
        permission={{ ...approvalPermission(), kind: 'secret', requestId: 'secret-1' }}
        onApprovalChoice={vi.fn()}
        onMaskedSubmit={vi.fn()}
        onCancel={onCancel}
      />
    ));

    fireEvent.keyDown(screen.getByPlaceholderText('Value'), { key: 'Escape' });

    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('user input card pages through questions and submits answers atomically', () => {
    const onSubmit = vi.fn();
    render(() => (
      <UserInputRequestCard
        questions={userInputQuestions()}
        onSubmit={onSubmit}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Broad/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Loose/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(onSubmit).toHaveBeenCalledWith({
      scope: { answers: ['Broad'] },
      density: { answers: ['Loose'] },
    });
  });

  test('user input card keeps selected answers when paging backward', () => {
    render(() => (
      <UserInputRequestCard
        questions={userInputQuestions()}
        onSubmit={vi.fn()}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Broad/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous question' }));

    expect(screen.getByRole('button', { name: /Broad/ }).getAttribute('aria-pressed')).toBe('true');
  });

  test('user input card free text overrides the selected option', () => {
    const onSubmit = vi.fn();
    render(() => (
      <UserInputRequestCard
        questions={[userInputQuestions()[0]]}
        onSubmit={onSubmit}
      />
    ));

    const input = screen.getByPlaceholderText('No, describe what to do differently') as HTMLInputElement;
    fireEvent.input(input, { target: { value: 'Use the safer path' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));

    expect(onSubmit).toHaveBeenCalledWith({ scope: { answers: ['Use the safer path'] } });
  });

  test('user input card dismiss button submits empty answers', () => {
    const onSubmit = vi.fn();
    render(() => (
      <UserInputRequestCard
        questions={userInputQuestions()}
        onSubmit={onSubmit}
      />
    ));

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/ }));

    expect(onSubmit).toHaveBeenCalledWith({
      scope: { answers: [] },
      density: { answers: [] },
    });
  });

  test('user input card Escape submits empty answers', () => {
    const onSubmit = vi.fn();
    render(() => (
      <UserInputRequestCard
        questions={[userInputQuestions()[0]]}
        onSubmit={onSubmit}
      />
    ));

    fireEvent.keyDown(screen.getByLabelText('User input request'), { key: 'Escape' });

    expect(onSubmit).toHaveBeenCalledWith({ scope: { answers: [] } });
  });

  test('user input card uses paginated layout for a single question', () => {
    render(() => (
      <UserInputRequestCard
        questions={[userInputQuestions()[0]]}
        onSubmit={vi.fn()}
      />
    ));

    expect(screen.getByText('1 of 1')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Previous question' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Next question' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Submit' })).toBeTruthy();
  });
});

function userInputQuestions() {
  return [
    {
      id: 'scope',
      header: 'Scope',
      question: 'Which scope?',
      options: [
        { label: 'Narrow', description: 'Only this panel.' },
        { label: 'Broad', description: 'Include recovery.' },
      ],
    },
    {
      id: 'density',
      header: 'Density',
      question: 'Choose a density.',
      options: [
        { label: 'Compact', description: 'Show more detail.' },
        { label: 'Loose', description: 'Use more breathing room.' },
      ],
    },
  ];
}

function approvalPermission(): PendingPermission {
  return {
    kind: 'approval',
    command: 'rm -rf tmp',
    description: 'Needs approval',
    isPathApproval: true,
  };
}
