import { createSignal } from 'solid-js';

export type SidePanelTab = 'workspace' | 'git' | 'delegation';

const [isOpen, setIsOpen] = createSignal(false);
const [activeTab, setActiveTab] = createSignal<SidePanelTab>('workspace');
const [panelWidth, setPanelWidth] = createSignal(500);

export const sidePanelStore = {
  isOpen,
  activeTab,
  panelWidth,
  setPanelWidth,

  open(tab?: SidePanelTab): void {
    if (tab) setActiveTab(tab);
    setIsOpen(true);
  },

  close(): void {
    setIsOpen(false);
  },

  toggle(tab?: SidePanelTab): void {
    if (isOpen()) {
      setIsOpen(false);
      return;
    }
    if (tab) setActiveTab(tab);
    setIsOpen(true);
  },

  setActiveTab(tab: SidePanelTab): void {
    setActiveTab(tab);
  },
};
