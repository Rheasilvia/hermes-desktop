import { createSignal } from 'solid-js';

export type SidePanelView = 'menu' | 'review' | 'terminal' | 'files' | 'delegation';
export type ToolTabView = Exclude<SidePanelView, 'menu'>;

const [isOpen, setIsOpen] = createSignal(false);
const [activeView, setActiveView] = createSignal<SidePanelView>('menu');
const [panelWidth, setPanelWidth] = createSignal(500);
const [openTabs, setOpenTabs] = createSignal<ToolTabView[]>([]);
const [toolMenuOpenRequested, setToolMenuOpenRequested] = createSignal(false);

const isToolTabView = (view: SidePanelView): view is ToolTabView => view !== 'menu';

const ensureOpenTab = (view: ToolTabView): void => {
  setOpenTabs((tabs) => (tabs.includes(view) ? tabs : [...tabs, view]));
};

const activateView = (view: SidePanelView): void => {
  if (isToolTabView(view)) {
    ensureOpenTab(view);
  }
  setActiveView(view);
};

export const sidePanelStore = {
  isOpen,
  activeView,
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

  open(view: SidePanelView = 'menu'): void {
    activateView(view);
    setIsOpen(true);
  },

  close(): void {
    setIsOpen(false);
    setToolMenuOpenRequested(false);
  },

  toggle(view: SidePanelView = 'menu'): void {
    if (isOpen()) {
      setIsOpen(false);
      setToolMenuOpenRequested(false);
      return;
    }
    activateView(view);
    setIsOpen(true);
  },

  setActiveView(view: SidePanelView): void {
    activateView(view);
  },

  openTab(view: ToolTabView): void {
    activateView(view);
    setIsOpen(true);
  },

  closeTab(view: ToolTabView): void {
    const next = openTabs().filter((tab) => tab !== view);
    setOpenTabs(next);
    // If the closed tab was active, fall back to the first remaining tab
    // (else the empty 'menu' state).
    if (activeView() === view) {
      setActiveView(next[0] ?? 'menu');
    }
    // When no tabs remain, collapse the dock entirely so the user is not
    // left looking at the empty "Select a tool" state.
    if (next.length === 0) {
      setIsOpen(false);
      setToolMenuOpenRequested(false);
    }
  },

  clearTabs(): void {
    setOpenTabs([]);
    setActiveView('menu');
    setToolMenuOpenRequested(false);
  },
};
