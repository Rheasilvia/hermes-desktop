import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@solidjs/testing-library';
import type { SkillInfo, SkillsToolset } from '@/services/api/index.js';
import { SkillsView } from '../SkillsView.js';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const MOCK_SKILLS: SkillInfo[] = [
  { name: 'code-review', description: 'Review code for issues', category: 'Development', enabled: true },
  { name: 'git-wizard', description: 'Advanced git operations', category: 'Development', enabled: true },
  { name: 'deep-research', description: 'Multi-source research', category: 'Research', enabled: false },
];

const MOCK_TOOLSETS: SkillsToolset[] = [
  {
    name: 'web',
    label: 'Web Tools',
    description: 'Browser and search tools',
    enabled: true,
    configured: true,
    tools: ['web_search', 'web_fetch'],
  },
  {
    name: 'files',
    label: 'File Operations',
    description: 'Read and write files',
    enabled: false,
    configured: false,
    tools: ['file_read', 'file_write'],
  },
];

// ─── Mocks ───────────────────────────────────────────────────────────────────
// vi.mock is hoisted to the top of the file, so mock fns must be declared with
// vi.hoisted to ensure they're initialised before the factory runs.

const { mockListSkills, mockToggleSkill, mockListToolsets } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockToggleSkill: vi.fn(),
  mockListToolsets: vi.fn(),
}));

vi.mock('@/services/api/index.js', () => ({
  api: {
    skills: vi.fn().mockReturnValue({
      listSkills: mockListSkills,
      toggleSkill: mockToggleSkill,
      listToolsets: mockListToolsets,
    }),
  },
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SkillsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSkills.mockResolvedValue({ items: MOCK_SKILLS });
    mockListToolsets.mockResolvedValue({ items: MOCK_TOOLSETS });
    mockToggleSkill.mockResolvedValue({ ok: true });
  });

  // ── Loading state ──────────────────────────────────────────────────────────

  it('shows loading placeholder before data arrives', () => {
    // Never resolves during this assertion
    mockListSkills.mockReturnValue(new Promise(() => {}));
    mockListToolsets.mockReturnValue(new Promise(() => {}));
    render(() => <SkillsView />);
    // Skills list must not be visible yet
    expect(screen.queryByText('code-review')).toBeNull();
  });

  // ── Skills tab ─────────────────────────────────────────────────────────────

  it('renders all skills after data loads', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('code-review'));
    expect(screen.getByText('git-wizard')).toBeTruthy();
    expect(screen.getByText('deep-research')).toBeTruthy();
  });

  it('shows correct skill count in toolbar', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('3 skills'));
  });

  it('shows category names in left pane', async () => {
    render(() => <SkillsView />);
    // Category buttons have text "[name] [count]" — use role query to avoid matching Pill spans
    await waitFor(() => screen.getByRole('button', { name: /Development/ }));
    expect(screen.getByRole('button', { name: /Research/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /All/ })).toBeTruthy();
  });

  it('filters to selected category', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByRole('button', { name: /Development/ }));

    fireEvent.click(screen.getByRole('button', { name: /Development/ }));

    await waitFor(() => {
      expect(screen.getByText('code-review')).toBeTruthy();
      expect(screen.getByText('git-wizard')).toBeTruthy();
      expect(screen.queryByText('deep-research')).toBeNull();
    });
  });

  it('filters by search query', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByPlaceholderText('Search skills…'));

    const input = screen.getByPlaceholderText('Search skills…');
    fireEvent.input(input, { target: { value: 'research' } });

    await waitFor(() => {
      expect(screen.queryByText('code-review')).toBeNull();
      expect(screen.getByText('deep-research')).toBeTruthy();
    });
  });

  it('shows empty state when no skills match search', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByPlaceholderText('Search skills…'));

    fireEvent.input(screen.getByPlaceholderText('Search skills…'), {
      target: { value: 'zzznomatch' },
    });

    await waitFor(() => screen.getByText('No skills found'));
  });

  // ── Toggle / optimistic update ─────────────────────────────────────────────

  it('calls toggleSkill when a skill is switched', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getAllByRole('switch'));

    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]);

    await waitFor(() => {
      expect(mockToggleSkill).toHaveBeenCalledWith('code-review', false);
    });
  });

  it('optimistically updates toggle state before API responds', async () => {
    let resolveFn!: () => void;
    mockToggleSkill.mockReturnValue(new Promise((r) => { resolveFn = r; }));

    render(() => <SkillsView />);
    await waitFor(() => screen.getAllByRole('switch'));

    const [firstSwitch] = screen.getAllByRole('switch');
    expect(firstSwitch.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(firstSwitch);

    // Reflected immediately before API resolves
    await waitFor(() =>
      expect(firstSwitch.getAttribute('aria-checked')).toBe('false')
    );

    resolveFn();
  });

  it('rolls back toggle state when API call fails', async () => {
    mockToggleSkill.mockRejectedValueOnce(new Error('network error'));

    render(() => <SkillsView />);
    await waitFor(() => screen.getAllByRole('switch'));

    // Re-query inside each assertion: For reconciles by reference, so setSkills
    // creates new Toggle DOM nodes — a captured ref becomes stale after the update.
    expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getAllByRole('switch')[0]);

    // Wait for optimistic update (new Toggle mounted with enabled=false)
    await waitFor(() =>
      expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('false')
    );

    // After rejection, For mounts another new Toggle with enabled=true
    await waitFor(() =>
      expect(screen.getAllByRole('switch')[0].getAttribute('aria-checked')).toBe('true')
    );
  });

  // ── Toolsets tab ───────────────────────────────────────────────────────────

  it('switches to Toolsets tab on click', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('code-review'));

    fireEvent.click(screen.getByRole('button', { name: /toolsets/i }));

    await waitFor(() => screen.getByText('Web Tools'));
  });

  it('renders toolset cards with label and tools', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('code-review'));

    fireEvent.click(screen.getByRole('button', { name: /toolsets/i }));

    await waitFor(() => {
      expect(screen.getByText('Web Tools')).toBeTruthy();
      expect(screen.getByText('File Operations')).toBeTruthy();
      expect(screen.getByText('web_search')).toBeTruthy();
    });
  });

  it('shows "Setup needed" badge for unconfigured toolsets', async () => {
    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('code-review'));

    fireEvent.click(screen.getByRole('button', { name: /toolsets/i }));

    await waitFor(() => screen.getByText('Setup needed'));
  });

  it('shows empty state when no toolsets are returned', async () => {
    mockListToolsets.mockResolvedValue({ items: [] });

    render(() => <SkillsView />);
    await waitFor(() => screen.getByText('code-review'));

    fireEvent.click(screen.getByRole('button', { name: /toolsets/i }));

    await waitFor(() => screen.getByText('No toolsets available'));
  });
});
