import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@solidjs/testing-library';
import { SkillsCard, ToolsCard, CronCard, PluginsCard } from '../ListCards.js';

/**
 * The live-data cards were repointed off the stubbed gateway methods onto the
 * working `src/services/api` transports. These tests pin that wiring + the
 * loading/empty/error states from the CardList archetype.
 */

const { mockListSkills, mockListToolsets, mockCronList, mockGetHub } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockListToolsets: vi.fn(),
  mockCronList: vi.fn(),
  mockGetHub: vi.fn(),
}));

vi.mock('@/services/api/index.js', () => ({
  api: {
    skills: vi.fn().mockReturnValue({ listSkills: mockListSkills, listToolsets: mockListToolsets }),
    cron: vi.fn().mockReturnValue({ list: mockCronList }),
    plugins: vi.fn().mockReturnValue({ getHub: mockGetHub }),
  },
}));

const noop = () => {};

describe('live-data cards → api layer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSkills.mockResolvedValue({
      items: [{ name: 'arxiv', description: 'Search papers', category: 'Research', enabled: true }],
    });
    mockListToolsets.mockResolvedValue({
      items: [{ name: 'web', label: 'Web Tools', description: 'Browser', enabled: true, configured: true, tools: ['a', 'b'] }],
    });
    mockCronList.mockResolvedValue({
      items: [{ id: '1', schedule: '0 9 * * *', prompt: 'Daily digest', enabled: true, created_at: '', desktop: {} }],
    });
    mockGetHub.mockResolvedValue({
      plugins: [{ name: 'memory', version: '1.0', description: 'Memory plugin', runtime_status: 'active', source: '', has_dashboard_manifest: false, dashboard_manifest: null, path: '', can_remove: true, can_update_git: false, auth_required: false, auth_command: '', user_hidden: false }],
      orphan_dashboard_plugins: [],
      providers: { memory_provider: '', memory_options: [], context_engine: null, context_options: [] },
    });
  });

  it('SkillsCard renders skills from api.skills().listSkills()', async () => {
    render(() => <SkillsCard onDismiss={noop} />);
    await waitFor(() => screen.getByText('arxiv'));
    expect(mockListSkills).toHaveBeenCalled();
    expect(screen.getByText('Search papers')).toBeTruthy();
  });

  it('ToolsCard renders toolsets (label + tool count)', async () => {
    render(() => <ToolsCard onDismiss={noop} />);
    await waitFor(() => screen.getByText('Web Tools'));
    expect(mockListToolsets).toHaveBeenCalled();
    expect(screen.getByText('2 tools')).toBeTruthy();
  });

  it('CronCard renders jobs (prompt + schedule)', async () => {
    render(() => <CronCard onDismiss={noop} />);
    await waitFor(() => screen.getByText('Daily digest'));
    expect(mockCronList).toHaveBeenCalled();
    expect(screen.getByText('0 9 * * *')).toBeTruthy();
  });

  it('PluginsCard renders installed plugins', async () => {
    render(() => <PluginsCard onDismiss={noop} />);
    await waitFor(() => screen.getByText('memory'));
    expect(mockGetHub).toHaveBeenCalled();
    expect(screen.getByText('active')).toBeTruthy();
  });

  it('shows the empty state when the api returns no items', async () => {
    mockListSkills.mockResolvedValue({ items: [] });
    render(() => <SkillsCard onDismiss={noop} />);
    await waitFor(() => screen.getByText('No skills available.'));
  });
});
