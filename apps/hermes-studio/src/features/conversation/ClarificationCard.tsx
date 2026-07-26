import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import styles from './ClarificationCard.module.css';

interface ClarificationCardProps {
  question: string;
  choices: string[] | null;
  onRespond: (text: string) => void;
}

export const ClarificationCard: Component<ClarificationCardProps> = (props) => {
  const [selectedIndex, setSelectedIndex] = createSignal<number | null>(null);
  const [freeText, setFreeText] = createSignal('');

  const choices = () => props.choices ?? [];

  const handleChoice = (choice: string, index: number) => {
    setSelectedIndex(index);
    setFreeText('');
    props.onRespond(choice);
  };

  const moveSelection = (delta: 1 | -1) => {
    const items = choices();
    if (items.length === 0) return;
    setSelectedIndex((current) => {
      if (current == null) return delta > 0 ? 0 : items.length - 1;
      return (current + delta + items.length) % items.length;
    });
  };

  const handleCardKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onRespond('');
      return;
    }
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
      return;
    }
    if (e.key === 'Enter') {
      const index = selectedIndex();
      const choice = index == null ? null : choices()[index];
      if (!choice) return;
      e.preventDefault();
      props.onRespond(choice);
    }
  };

  const handleFreeText = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      props.onRespond('');
      return;
    }
    if (e.key === 'Enter' && freeText().trim()) {
      props.onRespond(freeText().trim());
    }
  };

  return (
    <div
      class={styles.card}
      role="group"
      aria-label={props.question}
      tabIndex={0}
      onKeyDown={handleCardKeyDown}
    >
      <div class={styles.header}>
        <span class={styles.dots}>
          <span class={`${styles.dot} ${styles.dot1}`} />
          <span class={`${styles.dot} ${styles.dot2}`} />
          <span class={`${styles.dot} ${styles.dot3}`} />
        </span>
        <span class={styles.title}>{props.question}</span>
      </div>
      <Show when={props.choices && props.choices.length > 0}>
        <div class={styles.choices}>
          <For each={props.choices!}>
            {(choice, index) => (
              <button
                class={styles.choiceBtn}
                classList={{ [styles.choiceBtnSelected!]: selectedIndex() === index() }}
                aria-selected={selectedIndex() === index()}
                onClick={() => handleChoice(choice, index())}
              >
                {choice}
              </button>
            )}
          </For>
        </div>
      </Show>
      <div class={styles.freeTextWrapper}>
        <input
          class={styles.freeText}
          type="text"
          placeholder="Or type your answer…"
          value={freeText()}
          onInput={(e) => setFreeText(e.currentTarget.value)}
          onKeyDown={handleFreeText}
        />
      </div>
    </div>
  );
};
