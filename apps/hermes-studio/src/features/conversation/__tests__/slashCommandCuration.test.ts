import { describe, expect, it } from 'vitest';
import {
  filterDesktopSlashCommands,
  isDesktopSlashExtensionCommand,
  isDesktopSlashSuggestion,
} from '../slashCommandCuration.js';

describe('slash command curation', () => {
  it('keeps curated desktop built-ins visible', () => {
    expect(isDesktopSlashSuggestion('/help')).toBe(true);
    expect(isDesktopSlashSuggestion('queue')).toBe(true);
  });

  it('hides noisy built-ins owned by terminal, settings, messaging, or picker UI', () => {
    expect(isDesktopSlashSuggestion('/model')).toBe(false);
    expect(isDesktopSlashSuggestion('/skills')).toBe(false);
    expect(isDesktopSlashSuggestion('/approve')).toBe(false);
    expect(isDesktopSlashSuggestion('/tools')).toBe(false);
  });

  it('keeps skill and quick command extensions discoverable', () => {
    expect(isDesktopSlashExtensionCommand('/codex-review')).toBe(true);
    expect(isDesktopSlashSuggestion('/codex-review')).toBe(true);
  });

  it('filters completion results without dropping extensions', () => {
    const filtered = filterDesktopSlashCommands([
      { command: 'help', description: 'Show help', category: 'Info' },
      { command: 'model', description: 'Switch model', category: 'Configuration' },
      { command: 'my-skill', description: 'Run a skill', category: 'Skills' },
      { command: 'tools', description: 'Terminal tools list', category: 'Info' },
    ]);

    expect(filtered.map((cmd) => cmd.command)).toEqual(['help', 'my-skill']);
  });
});
