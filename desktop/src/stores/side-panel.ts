import { createSignal } from 'solid-js';

export type SidePanelView = 'menu' | 'review' | 'terminal' | 'files' | 'delegation';
export type ToolTabView = Exclude<SidePanelView, 'menu'>;
export type ToolTabKind = ToolTabView;

export interface ToolTab {
  id: string;
  kind: ToolTabKind;
  title: string;
  cwd: string | null;
}

interface OpenToolTabOptions {
  cwd?: string | null;
  title?: string | null;
}

const DEFAULT_TOOL_TITLES: Record<ToolTabKind, string> = {
  review: 'Review',
  terminal: 'Terminal',
  files: 'Open file',
  delegation: 'Delegation',
};

const [isOpen, setIsOpen] = createSignal(false);
const [activeTabId, setActiveTabId] = createSignal<string | null>(null);
const [panelWidth, setPanelWidth] = createSignal(500);
const [openTabs, setOpenTabs] = createSignal<ToolTab[]>([]);
const [toolMenuOpenRequested, setToolMenuOpenRequested] = createSignal(false);
let nextTerminalTabNumber = 1;

const isToolTabView = (view: SidePanelView): view is ToolTabView => view !== 'menu';

const activeTab = () => openTabs().find((tab) => tab.id === activeTabId()) ?? null;

const activeView = (): SidePanelView => activeTab()?.kind ?? 'menu';

const normalizeCwd = (cwd: string | null | undefined) => {
  const trimmed = cwd?.trim();
  return trimmed ? trimmed : null;
};

const titleFromCwd = (cwd: string | null | undefined) => {
  const normalized = normalizeCwd(cwd);
  if (!normalized) return DEFAULT_TOOL_TITLES.terminal;
  const withoutTrailingSlash = normalized.replace(/[\\/]+$/, '');
  const name = withoutTrailingSlash.split(/[\\/]/).filter(Boolean).pop();
  return name || DEFAULT_TOOL_TITLES.terminal;
};

const uniqueTerminalTitle = (baseTitle: string) => {
  const existing = new Set(openTabs()
    .filter((tab) => tab.kind === 'terminal')
    .map((tab) => tab.title));
  if (!existing.has(baseTitle)) return baseTitle;

  let suffix = 2;
  let candidate = `${baseTitle} ${suffix}`;
  while (existing.has(candidate)) {
    suffix += 1;
    candidate = `${baseTitle} ${suffix}`;
  }
  return candidate;
};

const singletonTabId = (view: Exclude<ToolTabKind, 'terminal'>) => `tool-${view}`;

const createToolTab = (view: ToolTabKind, options: OpenToolTabOptions = {}): ToolTab => {
  if (view === 'terminal') {
    const baseTitle = options.title?.trim() || titleFromCwd(options.cwd);
    const id = `terminal-${nextTerminalTabNumber}`;
    nextTerminalTabNumber += 1;
    return {
      id,
      kind: 'terminal',
      title: uniqueTerminalTitle(baseTitle),
      cwd: normalizeCwd(options.cwd),
    };
  }

  return {
    id: singletonTabId(view),
    kind: view,
    title: DEFAULT_TOOL_TITLES[view],
    cwd: null,
  };
};

const ensureActiveTabStillExists = () => {
  if (!activeTabId()) return;
  if (openTabs().some((tab) => tab.id === activeTabId())) return;
  setActiveTabId(openTabs()[0]?.id ?? null);
};

const activateView = (view: SidePanelView, options: OpenToolTabOptions = {}): void => {
  if (!isToolTabView(view)) {
    setActiveTabId(null);
    return;
  }

  if (view === 'terminal') {
    const existingTerminal = openTabs().find((tab) => tab.kind === 'terminal');
    if (existingTerminal) {
      setActiveTabId(existingTerminal.id);
      return;
    }
    const tab = createToolTab('terminal', options);
    setOpenTabs((tabs) => [...tabs, tab]);
    setActiveTabId(tab.id);
    return;
  }

  const existing = openTabs().find((tab) => tab.kind === view);
  if (existing) {
    setActiveTabId(existing.id);
    return;
  }

  const tab = createToolTab(view);
  setOpenTabs((tabs) => [...tabs, tab]);
  setActiveTabId(tab.id);
};

const openDockToView = (view: SidePanelView, options: OpenToolTabOptions = {}) => {
  if (isToolTabView(view)) {
    activateView(view, options);
  } else if (openTabs().length === 0) {
    setActiveTabId(null);
  } else {
    ensureActiveTabStillExists();
  }
};

const tabToClose = (idOrView: string) => {
  const tabs = openTabs();
  const exact = tabs.find((tab) => tab.id === idOrView);
  if (exact) return exact;

  if (activeTab()?.kind === idOrView) return activeTab();
  return tabs.find((tab) => tab.kind === idOrView);
};

export const sidePanelStore = {
  isOpen,
  activeView,
  activeTab,
  activeTabId,
  openTabs,
  panelWidth,
  toolMenuOpenRequested,
  setPanelWidth,

  requestToolMenuOpen(): void {
    setToolMenuOpenRequested(true);
  },

  clearToolMenuOpenRequest(): void {
    setToolMenuOpenRequested(false);
  },

  open(view: SidePanelView = 'menu', options: OpenToolTabOptions = {}): void {
    openDockToView(view, options);
    setIsOpen(true);
  },

  close(): void {
    setIsOpen(false);
    setToolMenuOpenRequested(false);
  },

  toggle(view: SidePanelView = 'menu', options: OpenToolTabOptions = {}): void {
    if (isOpen()) {
      setIsOpen(false);
      setToolMenuOpenRequested(false);
      return;
    }
    openDockToView(view, options);
    setIsOpen(true);
  },

  setActiveView(view: SidePanelView, options: OpenToolTabOptions = {}): void {
    activateView(view, options);
  },

  setActiveTab(id: string): void {
    if (!openTabs().some((tab) => tab.id === id)) return;
    setActiveTabId(id);
  },

  openTab(view: ToolTabView, options: OpenToolTabOptions = {}): ToolTab {
    if (view === 'terminal') {
      const tab = createToolTab(view, options);
      setOpenTabs((tabs) => [...tabs, tab]);
      setActiveTabId(tab.id);
      setIsOpen(true);
      return tab;
    }

    const existing = openTabs().find((tab) => tab.kind === view);
    if (existing) {
      setActiveTabId(existing.id);
      setIsOpen(true);
      return existing;
    }

    const tab = createToolTab(view);
    setOpenTabs((tabs) => [...tabs, tab]);
    setActiveTabId(tab.id);
    setIsOpen(true);
    return tab;
  },

  closeTab(idOrView: string): void {
    const closing = tabToClose(idOrView);
    if (!closing) return;

    const previous = openTabs();
    const closedIndex = previous.findIndex((tab) => tab.id === closing.id);
    const next = previous.filter((tab) => tab.id !== closing.id);
    setOpenTabs(next);

    if (activeTabId() === closing.id) {
      setActiveTabId(next[closedIndex]?.id ?? next[closedIndex - 1]?.id ?? null);
    }

    if (next.length === 0) {
      setIsOpen(false);
      setToolMenuOpenRequested(false);
    }
  },

  renameTab(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    setOpenTabs((tabs) => tabs.map((tab) => (
      tab.id === id ? { ...tab, title: trimmed } : tab
    )));
  },

  clearTabs(): void {
    setOpenTabs([]);
    setActiveTabId(null);
    setToolMenuOpenRequested(false);
  },
};
