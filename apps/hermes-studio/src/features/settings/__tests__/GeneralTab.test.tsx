import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';

const settingsState = vi.hoisted(() => ({
  value: {
    theme: 'light',
    language: 'en',
    fontSize: 100,
    reducedMotion: false,
    autoSave: true,
    confirmDestructive: true,
    startupBehavior: 'restore',
    showCost: false,
    showReasoning: false,
  },
}));

vi.mock('@/stores/ui.js', () => ({
  uiStore: { theme: 'light' },
}));

vi.mock('@/services/theme.js', () => ({
  setTheme: vi.fn(),
}));

vi.mock('@/services/desktop-settings.js', () => ({
  loadDesktopSettings: vi.fn(async () => ({ ...settingsState.value })),
  saveDesktopSettings: vi.fn(),
  applyDesktopSettings: vi.fn(),
}));

import { GeneralTab } from '../tabs/GeneralTab.js';

describe('Hermes Studio general settings', () => {
  it('does not offer an updater setting in the first Electron release', async () => {
    render(() => <GeneralTab />);

    expect(await screen.findByText('System')).toBeDefined();
    expect(screen.queryByText('Check for Updates')).toBeNull();
    expect(screen.queryByText('Automatically check for new versions')).toBeNull();
  });
});
