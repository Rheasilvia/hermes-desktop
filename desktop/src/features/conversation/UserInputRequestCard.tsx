import type { Component } from 'solid-js';
import { For, createMemo, createSignal } from 'solid-js';
import type { UserInputAnswersPayload, UserInputQuestionPayload } from '@/types/gateway.js';
import styles from './UserInputRequestCard.module.css';

interface UserInputRequestCardProps {
  questions: UserInputQuestionPayload[];
  onSubmit: (answers: UserInputAnswersPayload) => void;
}

export const UserInputRequestCard: Component<UserInputRequestCardProps> = (props) => {
  const [values, setValues] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);

  const normalizedQuestions = createMemo(() => props.questions.slice(0, 3));
  const canSubmit = createMemo(() =>
    normalizedQuestions().length > 0 &&
    normalizedQuestions().every((question) => (values()[question.id] ?? '').trim().length > 0) &&
    !submitting()
  );

  const setAnswer = (id: string, value: string) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  const submit = () => {
    if (!canSubmit()) return;
    const answers: UserInputAnswersPayload = {};
    for (const question of normalizedQuestions()) {
      const value = (values()[question.id] ?? '').trim();
      answers[question.id] = { answers: [value] };
    }
    setSubmitting(true);
    props.onSubmit(answers);
  };

  return (
    <form
      class={styles.card}
      aria-label="User input request"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div class={styles.header}>
        <span class={styles.pulse} aria-hidden="true" />
        <span class={styles.title}>Waiting for your input</span>
      </div>

      <div class={styles.questions}>
        <For each={normalizedQuestions()}>
          {(question, index) => {
            const selected = () => values()[question.id] ?? '';
            const inputId = `user-input-${question.id}`;
            return (
              <fieldset class={styles.question}>
                <legend class={styles.legend}>
                  <span class={styles.questionHeader}>{question.header || `Question ${index() + 1}`}</span>
                  <span class={styles.questionText}>{question.question}</span>
                </legend>
                <div class={styles.options}>
                  <For each={question.options ?? []}>
                    {(option) => (
                      <button
                        type="button"
                        class={styles.option}
                        classList={{ [styles.optionSelected]: selected() === option.label }}
                        aria-pressed={selected() === option.label}
                        disabled={submitting()}
                        onClick={() => setAnswer(question.id, option.label)}
                      >
                        <span class={styles.optionLabel}>{option.label}</span>
                        <span class={styles.optionDescription}>{option.description}</span>
                      </button>
                    )}
                  </For>
                </div>
                <label class={styles.freeTextLabel} for={inputId}>Answer</label>
                <input
                  id={inputId}
                  class={styles.freeText}
                  value={selected()}
                  disabled={submitting()}
                  placeholder="Type an answer"
                  onInput={(event) => setAnswer(question.id, event.currentTarget.value)}
                />
              </fieldset>
            );
          }}
        </For>
      </div>

      <div class={styles.actions}>
        <button class={styles.submit} type="submit" disabled={!canSubmit()}>
          Submit
        </button>
      </div>
    </form>
  );
};
