import { Dynamic } from 'solid-js/web';
import type { Component } from 'solid-js';
import type { CardType } from '@/types/command-card.js';
import { cardRegistry } from './cardRegistry.js';
import { OutputCard } from './TextCards.js';

export interface ActiveCommandCard {
  cardType: CardType;
  text?: string;
}

/**
 * Renders the card for `card.cardType` from the registry, passing the text
 * payload (CLI/notice cards) and the dismiss callback. Falls back to a plain
 * output card if a type somehow has no entry (shouldn't happen — the registry
 * is exhaustiveness-checked at compile time).
 */
export const CommandCardRenderer: Component<{
  card: ActiveCommandCard;
  onDismiss: () => void;
}> = (props) => {
  const entry = () => cardRegistry[props.card.cardType] ?? { Component: OutputCard };
  return (
    <Dynamic
      component={entry().Component}
      text={props.card.text}
      onDismiss={props.onDismiss}
    />
  );
};
