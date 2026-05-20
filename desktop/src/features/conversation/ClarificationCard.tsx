import type { Component } from 'solid-js';
import { For, Show, createSignal } from 'solid-js';
import styles from './ClarificationCard.module.css';

interface ClarificationCardProps {
  question: string;
  choices: string[] | null;
  onRespond: (text: string) => void;
}

export const ClarificationCard: Component<ClarificationCardProps> = (props) => {
  const [selected, setSelected] = createSignal<string | null>(null);
  const [freeText, setFreeText] = createSignal('');

  const handleChoice = (choice: string) => {
    setSelected(choice);
    setFreeText('');
    props.onRespond(choice);
  };

  const handleFreeText = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && freeText().trim()) {
      props.onRespond(freeText().trim());
    }
  };

  return (
    <div class={styles.card}>
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
            {(choice) => (
              <button
                class={styles.choiceBtn}
                classList={{ [styles.choiceBtnSelected!]: selected() === choice }}
                onClick={() => handleChoice(choice)}
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
