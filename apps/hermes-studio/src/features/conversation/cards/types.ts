import type { Component } from 'solid-js';
import type { CardType } from '@/types/command-card.js';

/** Props every command card receives from the dock renderer. */
export interface CardComponentProps {
  /** Text payload for CLI/notice/output cards (undefined for live-data cards). */
  text?: string;
  /** Dismiss the card and return focus to the input. */
  onDismiss: () => void;
}

/** A registered card: its chrome metadata + the component to render. */
export interface CardModule {
  icon: string;
  title: string;
  Component: Component<CardComponentProps>;
}

export type { CardType };
