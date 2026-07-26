import { createSignal } from 'solid-js';
import type { ActiveCommandCard } from './cards/CommandCardRenderer.js';

export interface CommandCardState {
  commandCard: () => ActiveCommandCard | null;
  setCommandCard: (card: ActiveCommandCard | null) => void;
  dismissCommandCard: () => void;
  noticeCard: (text: string) => void;
}

export function createCommandCardState(): CommandCardState {
  const [commandCard, setCommandCard] = createSignal<ActiveCommandCard | null>(null);

  const dismissCommandCard = () => {
    setCommandCard(null);
    queueMicrotask(() => (document.querySelector('textarea') as HTMLTextAreaElement | null)?.focus());
  };

  const noticeCard = (text: string) => setCommandCard({ cardType: 'notice', text });

  return { commandCard, setCommandCard, dismissCommandCard, noticeCard };
}
