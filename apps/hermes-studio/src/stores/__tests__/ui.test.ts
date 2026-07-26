import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'hermes-desktop-todo-panel-dismissed';

// SolidJS effects run on a microtask; flush a couple of turns before asserting
// on the localStorage side effect.
async function flushEffects() {
  await Promise.resolve();
  await Promise.resolve();
}

// Fresh module instance each call — re-reads localStorage at import, which is how
// the store behaves on an app restart.
async function loadUiStore() {
  vi.resetModules();
  return (await import('../ui.js')).uiStore;
}

async function loadUiModule() {
  vi.resetModules();
  return import('../ui.js');
}

describe('uiStore — floating todo panel dismissal', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('records and clears dismissal per session, in isolation', async () => {
    const uiStore = await loadUiStore();
    expect(uiStore.isTodoPanelDismissed('sess-a')).toBe(false);

    uiStore.dismissTodoPanel('sess-a');
    expect(uiStore.isTodoPanelDismissed('sess-a')).toBe(true);
    // Dismissing one session must not leak to another.
    expect(uiStore.isTodoPanelDismissed('sess-b')).toBe(false);

    uiStore.restoreTodoPanel('sess-a');
    expect(uiStore.isTodoPanelDismissed('sess-a')).toBe(false);
  });

  it('clamps sidebar width through the shared helper and store setter', async () => {
    const { clampSidebarWidth, uiStore } = await loadUiModule();

    expect(clampSidebarWidth(120)).toBe(200);
    expect(clampSidebarWidth(280)).toBe(280);
    expect(clampSidebarWidth(480)).toBe(360);

    uiStore.setSidebarWidth(480);
    expect(uiStore.sidebarWidth).toBe(360);
  });

  it('dedupes repeated dismissals', async () => {
    const uiStore = await loadUiStore();
    uiStore.dismissTodoPanel('sess-a');
    uiStore.dismissTodoPanel('sess-a');
    await flushEffects();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual(['sess-a']);
  });

  it('persists dismissal across a reload (re-import reads it back)', async () => {
    const uiStore = await loadUiStore();
    uiStore.dismissTodoPanel('sess-a');
    await flushEffects();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toContain('sess-a');

    // Simulate restart: a fresh module instance restores the dismissed state.
    const reloaded = await loadUiStore();
    expect(reloaded.isTodoPanelDismissed('sess-a')).toBe(true);
  });

  it('restoring a never-dismissed session is a no-op', async () => {
    const uiStore = await loadUiStore();
    uiStore.restoreTodoPanel('sess-z');
    await flushEffects();
    expect(uiStore.isTodoPanelDismissed('sess-z')).toBe(false);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([]);
  });
});
