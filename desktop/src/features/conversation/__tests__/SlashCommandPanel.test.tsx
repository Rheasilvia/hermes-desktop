import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, test, expect, vi } from 'vitest';
import { SlashCommandPanel, type SlashCommand } from '../SlashCommandPanel.js';

const MOCK_COMMANDS: SlashCommand[] = [
  { command: 'help', description: 'Show available commands.', category: 'Built-in', icon: 'info' },
  { command: 'clear', description: 'Clear conversation history.', category: 'Built-in', icon: 'x' },
  { command: 'new', description: 'Start a new session.', category: 'Session', icon: 'plus' },
  { command: 'summarize', description: 'Summarize the conversation.', category: 'Skills', icon: 'file-text' },
  { command: 'review', description: 'Run code review.', category: 'Skills', icon: 'file-check' },
  { command: 'remember', description: 'Store in long-term memory.', category: 'Memory', icon: 'save' },
];

describe('SlashCommandPanel', () => {
  test('renders browse mode with categories when filter is empty', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter=""
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    expect(screen.getByText('BUILT-IN')).toBeDefined();
    expect(screen.getByText('SKILLS')).toBeDefined();
    expect(screen.getByText('MEMORY')).toBeDefined();
  });

  test('browse mode lists commands from non-hardcoded categories (e.g. Session)', () => {
    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter=""
        visible={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));

    // The Session category and its command must both render in browse mode —
    // the old hardcoded ['Built-in','Skills','Memory'] order dropped them.
    expect(screen.getByText('SESSION')).toBeDefined();
    expect(screen.getByText('/new')).toBeDefined();
  });

  test('browse mode lists Skills before Session (most-used first)', () => {
    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter=""
        visible={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const skills = screen.getByText('SKILLS');
    const session = screen.getByText('SESSION');
    // Skills appears earlier in the document than Session.
    expect(skills.compareDocumentPosition(session) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('renders filter mode with results count when filter is not empty', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter="sum"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    expect(screen.getByText(/Commands · 1 result/)).toBeDefined();
    expect(screen.getByText('/summarize')).toBeDefined();
  });

  test('does not render when not visible', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter=""
        visible={false}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    expect(screen.queryByText('BUILT-IN')).toBeNull();
  });

  test('calls onSelect when a command row is clicked', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter="help"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    const row = screen.getByText('/help').closest('div[class*="commandRow"]');
    if (row) {
      fireEvent.click(row);
    }
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  test('filters commands by description as well as command name', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter="memory"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    expect(screen.getByText('/remember')).toBeDefined();
    expect(screen.queryByText('/help')).toBeNull();
  });

  test('ranks a name match above a description-only match', () => {
    const cmds: SlashCommand[] = [
      // 'resume' appears only in this command's DESCRIPTION.
      { command: 'branch', description: 'Resume-friendly fork point', category: 'Session', icon: 'git-branch' },
      // ...and as this command's NAME — it must render first.
      { command: 'resume', description: 'Reopen a saved session', category: 'Session', icon: 'play' },
    ];
    render(() => (
      <SlashCommandPanel commands={cmds} filter="resume" visible={true} onSelect={vi.fn()} onClose={vi.fn()} />
    ));
    const resume = screen.getByText('/resume');
    const branch = screen.getByText('/branch');
    expect(resume.compareDocumentPosition(branch) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('shows no results when filter matches nothing', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();

    render(() => (
      <SlashCommandPanel
        commands={MOCK_COMMANDS}
        filter="xyz"
        visible={true}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    expect(screen.getByText(/Commands · 0 results/)).toBeDefined();
  });
});
