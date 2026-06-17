import type { Component } from 'solid-js';
import type { IconName } from '@/ui/atoms/Icon.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { HermesAvatar } from '@/ui/atoms/HermesAvatar.js';
import styles from './EmptyChatState.module.css';

export interface SuggestionCard {
  iconName: IconName;
  title: string;
  description: string;
}

interface EmptyChatStateProps {
  suggestions?: SuggestionCard[];
  onSuggestionClick?: (index: number) => void;
}

const DEFAULT_SUGGESTIONS: SuggestionCard[] = [
  { iconName: 'terminal', title: 'Debug my code', description: 'Analyze errors and suggest fixes' },
  { iconName: 'git-pull-request', title: 'Review my PR', description: 'Check code quality and patterns' },
  { iconName: 'lightbulb', title: 'Plan a feature', description: 'Design architecture and tasks' },
];

export const EmptyChatState: Component<EmptyChatStateProps> = (props) => {
  const suggestions = () => props.suggestions ?? DEFAULT_SUGGESTIONS;

  return (
    <div class={styles.wrapper}>
      <HermesAvatar size={52} />
      <h2 class={styles.heading}>How can I help you today?</h2>
      <p class={styles.subtitle}>Ask anything about your codebase, tasks, or ideas.</p>
      <div class={styles.grid}>
        {suggestions().map((card, i) => (
          <button
            class={styles.card}
            type="button"
            onClick={() => props.onSuggestionClick?.(i)}
          >
            <Icon name={card.iconName} size={18} class={styles.cardIcon} />
            <span class={styles.cardTitle}>{card.title}</span>
            <span class={styles.cardDesc}>{card.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
