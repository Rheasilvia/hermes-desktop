import type { Component } from 'solid-js';
import { For, Show, createMemo, createSignal } from 'solid-js';
import type { UserInputAnswersPayload, UserInputQuestionPayload } from '@/types/gateway.js';
import { Icon } from '@/ui/atoms/Icon.js';
import styles from './UserInputRequestCard.module.css';

interface UserInputRequestCardProps {
  questions: UserInputQuestionPayload[];
  onSubmit: (answers: UserInputAnswersPayload) => void;
}

export const UserInputRequestCard: Component<UserInputRequestCardProps> = (props) => {
  const [pageIndex, setPageIndex] = createSignal(0);
  const [selectedOptions, setSelectedOptions] = createSignal<Record<string, string>>({});
  const [freeTextValues, setFreeTextValues] = createSignal<Record<string, string>>({});
  const [submitting, setSubmitting] = createSignal(false);

  const normalizedQuestions = createMemo(() => props.questions.slice(0, 3));
  const pageCount = createMemo(() => Math.max(normalizedQuestions().length, 1));
  const currentPage = createMemo(() => Math.min(pageIndex(), pageCount() - 1));
  const currentQuestion = createMemo(() => normalizedQuestions()[currentPage()]);
  const isLastPage = createMemo(() => currentPage() >= pageCount() - 1);

  const selectedOptionFor = (question: UserInputQuestionPayload) =>
    selectedOptions()[question.id] ?? question.options?.[0]?.label ?? '';

  const freeTextFor = (question: UserInputQuestionPayload) => freeTextValues()[question.id] ?? '';

  const answerFor = (question: UserInputQuestionPayload) => {
    const typed = freeTextFor(question).trim();
    return typed.length > 0 ? typed : selectedOptionFor(question).trim();
  };

  const canUsePrimary = createMemo(() => {
    const question = currentQuestion();
    return Boolean(question && answerFor(question).length > 0 && !submitting());
  });

  const selectOption = (id: string, value: string) => {
    setSelectedOptions((current) => ({ ...current, [id]: value }));
    setFreeTextValues((current) => ({ ...current, [id]: '' }));
  };

  const setFreeText = (id: string, value: string) => {
    setFreeTextValues((current) => ({ ...current, [id]: value }));
  };

  const moveOptionSelection = (delta: 1 | -1) => {
    const question = currentQuestion();
    const options = question?.options ?? [];
    if (!question || options.length === 0) return;
    const current = selectedOptionFor(question);
    const currentIndex = Math.max(options.findIndex((option) => option.label === current), 0);
    const nextIndex = (currentIndex + delta + options.length) % options.length;
    selectOption(question.id, options[nextIndex].label);
  };

  const buildAnswers = (empty = false): UserInputAnswersPayload => {
    const answers: UserInputAnswersPayload = {};
    for (const question of normalizedQuestions()) {
      const value = empty ? '' : answerFor(question);
      answers[question.id] = { answers: value.length > 0 ? [value] : [] };
    }
    return answers;
  };

  const submitAnswers = (empty = false) => {
    if (submitting() || normalizedQuestions().length === 0) return;
    setSubmitting(true);
    props.onSubmit(buildAnswers(empty));
  };

  const usePrimaryAction = () => {
    if (!canUsePrimary()) return;
    if (!isLastPage()) {
      setPageIndex((current) => Math.min(current + 1, pageCount() - 1));
      return;
    }
    submitAnswers();
  };

  const goPrevious = () => {
    if (submitting()) return;
    setPageIndex((current) => Math.max(current - 1, 0));
  };

  const goNext = () => {
    if (!canUsePrimary() || isLastPage()) return;
    setPageIndex((current) => Math.min(current + 1, pageCount() - 1));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      submitAnswers(true);
      return;
    }
    if (event.target instanceof HTMLInputElement) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveOptionSelection(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveOptionSelection(-1);
    }
  };

  return (
    <form
      class={styles.card}
      aria-label="User input request"
      onKeyDown={handleKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        usePrimaryAction();
      }}
    >
      <div class={styles.topRow}>
        <div class={styles.questionText}>{currentQuestion()?.question ?? 'Waiting for your input'}</div>
        <div class={styles.pager} aria-label="Question pagination">
          <button
            class={styles.pagerButton}
            type="button"
            aria-label="Previous question"
            disabled={currentPage() === 0 || submitting()}
            onClick={goPrevious}
          >
            <Icon name="chevron-left" size={18} strokeWidth={2.2} />
          </button>
          <span class={styles.pageCount}>{currentPage() + 1} of {pageCount()}</span>
          <button
            class={styles.pagerButton}
            type="button"
            aria-label="Next question"
            disabled={isLastPage() || !canUsePrimary()}
            onClick={goNext}
          >
            <Icon name="chevron-right" size={18} strokeWidth={2.2} />
          </button>
        </div>
      </div>

      <Show when={currentQuestion()}>
        {(question) => {
          const inputId = `user-input-${question().id}`;
          const selectedOption = () => selectedOptionFor(question());
          return (
            <>
              <div class={styles.options}>
                <For each={question().options ?? []}>
                  {(option, index) => {
                    const selected = () =>
                      freeTextFor(question()).trim().length === 0 &&
                      selectedOption() === option.label;
                    return (
                      <button
                        type="button"
                        class={styles.option}
                        classList={{ [styles.optionSelected]: selected() }}
                        aria-pressed={selected()}
                        disabled={submitting()}
                        onClick={() => selectOption(question().id, option.label)}
                      >
                        <span class={styles.optionNumber}>{index() + 1}</span>
                        <span class={styles.optionLabel}>{option.label}</span>
                        <span
                          class={styles.optionInfo}
                          title={option.description || 'Option details'}
                          aria-label={option.description || 'Option details'}
                        >
                          <Icon name="info" size={15} strokeWidth={2} />
                        </span>
                        <Show when={selected()}>
                          <span class={styles.optionArrows} aria-hidden="true">
                            <Icon name="arrow-up" size={17} strokeWidth={1.7} />
                            <Icon name="arrow-down" size={17} strokeWidth={1.7} />
                          </span>
                        </Show>
                      </button>
                    );
                  }}
                </For>
              </div>

              <div class={styles.footer}>
                <label class={styles.freeTextWrap} for={inputId}>
                  <span class={styles.freeTextIcon} aria-hidden="true">
                    <Icon name="pencil" size={17} strokeWidth={1.8} />
                  </span>
                  <input
                    id={inputId}
                    class={styles.freeText}
                    value={freeTextFor(question())}
                    disabled={submitting()}
                    placeholder="No, and tell Codex what to do differently"
                    onInput={(event) => setFreeText(question().id, event.currentTarget.value)}
                  />
                </label>

                <div class={styles.actions}>
                  <button
                    class={styles.dismiss}
                    type="button"
                    disabled={submitting()}
                    onClick={() => submitAnswers(true)}
                  >
                    <span>Dismiss</span>
                    <kbd class={styles.keycap}>ESC</kbd>
                  </button>
                  <button class={styles.primary} type="submit" disabled={!canUsePrimary()}>
                    <span>{isLastPage() ? 'Submit' : 'Continue'}</span>
                    <span class={styles.returnIcon} aria-hidden="true">
                      <Icon name="corner-down-left" size={18} strokeWidth={2} />
                    </span>
                  </button>
                </div>
              </div>
            </>
          );
        }}
      </Show>
    </form>
  );
};
