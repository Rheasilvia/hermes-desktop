import { createSignal } from 'solid-js';

export type SidePanelView = 'menu' | 'review' | 'terminal' | 'files' | 'delegation';
export type ToolTabView = Exclude<SidePanelView, 'menu'>;

const [isOpen, setIsOpen] = createSignal(false);
const [activeView, setActiveView] = createSignal<SidePanelView>('menu');
const [panelWidth, setPanelWidth] = createSignal(500);
const [openTabs, setOpenTabs] = createSignal<ToolTabView[]>([]);

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
  setPanelWidth,

  open(view: SidePanelView = 'menu'): void {
    activateView(view);
    setIsOpen(true);
  },

  close(): void {
    setIsOpen(false);
  },

  toggle(view: SidePanelView = 'menu'): void {
    if (isOpen()) {
      setIsOpen(false);
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

  clearTabs(): void {
    setOpenTabs([]);
    setActiveView('menu');
  },
};
