import type { ReasoningEffort } from '@/types/index.js';

export const REASONING_EFFORT_OPTIONS: Array<{ value: ReasoningEffort; label: string }> = [
  { value: 'none', label: 'Off' },
  { value: 'minimal', label: 'Min' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Med' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
];

export function effortLabel(effort: ReasoningEffort): string {
  return REASONING_EFFORT_OPTIONS.find(option => option.value === effort)?.label ?? 'Med';
}

export function nextReasoningEffort(current: ReasoningEffort, direction: 1 | -1 = 1): ReasoningEffort {
  const index = REASONING_EFFORT_OPTIONS.findIndex(option => option.value === current);
  const currentIndex = index >= 0 ? index : REASONING_EFFORT_OPTIONS.findIndex(option => option.value === 'medium');
  const nextIndex = (currentIndex + direction + REASONING_EFFORT_OPTIONS.length) % REASONING_EFFORT_OPTIONS.length;
  return REASONING_EFFORT_OPTIONS[nextIndex].value;
}
