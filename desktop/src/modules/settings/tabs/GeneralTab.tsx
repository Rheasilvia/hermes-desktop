import type { Component } from 'solid-js';
import { createSignal, For, onMount, Show } from 'solid-js';
import { settingsStore } from '@/stores/settings.js';
import { uiStore } from '@/stores/ui.js';
import { ConfigField } from '../ConfigField.js';
import { setTheme, type ThemeName } from '@/services/theme.js';
import {
  loadDesktopSettings,
  saveDesktopSettings,
  applyDesktopSettings,
  type DesktopSettings,
} from '@/services/desktop-settings.js';
import styles from './GeneralTab.module.css';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
];

const STARTUP_OPTIONS = [
  { value: 'restore', label: 'Restore Last Session' },
  { value: 'new', label: 'New Session' },
];

const FONT_SIZE_OPTIONS = [
  { value: '90', label: 'Small' },
  { value: '100', label: 'Medium' },
  { value: '115', label: 'Large' },
];

interface ThemeSwatch {
  name: ThemeName;
  label: string;
  colors: string[];
}

const THEME_SWATCHES: ThemeSwatch[] = [
  {
    name: 'light',
    label: 'Light',
    colors: ['#FFFFFF', '#F5F0E8', '#C75B3A', '#2D2D2D'],
  },
  {
    name: 'dark',
    label: 'Dark',
    colors: ['#2D2D2D', '#1A1A1A', '#D46A4A', '#E5E5E5'],
  },
  {
    name: 'earth',
    label: 'Earth',
    colors: ['#F5F0E8', '#EDE7DE', '#B5522D', '#3D3529'],
  },
];

export const GeneralTab: Component = () => {
  const [desktop, setDesktop] = createSignal<DesktopSettings | null>(null);
  const [loading, setLoading] = createSignal(true);

  onMount(async () => {
    const ds = await loadDesktopSettings();
    setDesktop(ds);
    applyDesktopSettings(ds);
    setLoading(false);
  });

  const config = () => settingsStore.config;
  const display = () => config()?.display;

  const handleDesktopChange = async <K extends keyof DesktopSettings>(
    key: K,
    value: DesktopSettings[K],
  ) => {
    const current = desktop();
    if (!current) return;
    const next = { ...current, [key]: value };
    setDesktop(next);
    applyDesktopSettings(next);
    await saveDesktopSettings(next);
  };

  const handleThemeSelect = async (themeName: ThemeName) => {
    setTheme(themeName);
    await handleDesktopChange('theme', themeName);
  };

  const handleConfigChange = (key: string, value: unknown) => {
    settingsStore.markDirty();
    settingsStore.saveConfig(key, value);
  };

  const handleClearCache = async () => {
    if (!confirm('This will clear all cached files and temporary data. Continue?')) {
      return;
    }
    // TODO: implement cache clearing via Tauri
    alert('Cache cleared successfully.');
  };

  return (
    <Show when={!loading()} fallback={<div class={styles.loading}>Loading settings…</div>}>
      <div class={styles.tab}>
        <section class={styles.section}>
          <h3 class={styles.sectionTitle}>Appearance</h3>

          <div class={styles.themeSelector}>
            <div class={styles.themeLabel}>Theme</div>
            <div class={styles.themeDescription}>Choose your preferred color scheme</div>
            <div class={styles.swatchGrid}>
              <For each={THEME_SWATCHES}>
                {(swatch) => (
                  <button
                    type="button"
                    class={styles.swatchCard}
                    classList={{ [styles.swatchActive]: uiStore.theme === swatch.name }}
                    onClick={() => handleThemeSelect(swatch.name)}
                    aria-pressed={uiStore.theme === swatch.name}
                  >
                    <div class={styles.swatchPreview}>
                      <For each={swatch.colors}>
                        {(color) => (
                          <span class={styles.swatchColor} style={{ background: color }} />
                        )}
                      </For>
                    </div>
                    <span class={styles.swatchName}>{swatch.label}</span>
                  </button>
                )}
              </For>
            </div>
          </div>
        </section>

        <section class={styles.section}>
          <h3 class={styles.sectionTitle}>Interface</h3>
          <ConfigField
            label="Language"
            description="Interface language"
            type="select"
            value={desktop()?.language ?? 'en'}
            options={LANGUAGE_OPTIONS}
            onChange={(v) => handleDesktopChange('language', v as string)}
          />
          <ConfigField
            label="Font Size"
            description="Adjust the interface text size"
            type="select"
            value={String(desktop()?.fontSize ?? 100)}
            options={FONT_SIZE_OPTIONS}
            onChange={(v) => handleDesktopChange('fontSize', Number(v))}
          />
          <ConfigField
            label="Reduced Motion"
            description="Minimize animations throughout the interface"
            type="toggle"
            value={desktop()?.reducedMotion ?? false}
            onChange={(v) => handleDesktopChange('reducedMotion', v as boolean)}
          />
        </section>

        <section class={styles.section}>
          <h3 class={styles.sectionTitle}>Behavior</h3>
          <ConfigField
            label="Show Cost"
            description="Display token cost during conversations"
            type="toggle"
            value={display()?.show_cost ?? false}
            onChange={(v) => handleConfigChange('display.show_cost', v)}
          />
          <ConfigField
            label="Show Reasoning"
            description="Display model thinking and reasoning output"
            type="toggle"
            value={display()?.show_reasoning ?? false}
            onChange={(v) => handleConfigChange('display.show_reasoning', v)}
          />
          <ConfigField
            label="Auto-save Sessions"
            description="Automatically save conversation history"
            type="toggle"
            value={desktop()?.autoSave ?? true}
            onChange={(v) => handleDesktopChange('autoSave', v as boolean)}
          />
          <ConfigField
            label="Confirm Destructive Actions"
            description="Show confirmation before deleting data"
            type="toggle"
            value={desktop()?.confirmDestructive ?? true}
            onChange={(v) => handleDesktopChange('confirmDestructive', v as boolean)}
          />
        </section>

        <section class={styles.section}>
          <h3 class={styles.sectionTitle}>System</h3>
          <ConfigField
            label="Startup Behavior"
            description="What to show when the app launches"
            type="select"
            value={desktop()?.startupBehavior ?? 'restore'}
            options={STARTUP_OPTIONS}
            onChange={(v) => handleDesktopChange('startupBehavior', v as 'restore' | 'new')}
          />
          <ConfigField
            label="Check for Updates"
            description="Automatically check for new versions"
            type="toggle"
            value={desktop()?.checkUpdates ?? true}
            onChange={(v) => handleDesktopChange('checkUpdates', v as boolean)}
          />

          <div class={styles.fieldRow}>
            <div class={styles.fieldInfo}>
              <label class={styles.fieldLabel}>Clear Application Data</label>
              <p class={styles.fieldDescription}>Remove cached files and temporary data</p>
            </div>
            <button class={styles.clearBtn} onClick={handleClearCache} type="button">
              Clear Cache
            </button>
          </div>
        </section>
      </div>
    </Show>
  );
};
