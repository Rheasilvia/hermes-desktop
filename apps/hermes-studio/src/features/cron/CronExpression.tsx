import type { Component } from 'solid-js';
import { createMemo, Show } from 'solid-js';
import styles from './CronExpression.module.css';

interface CronExpressionProps {
  expression: string;
}

function parseCronHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;

  const [minute, hour, , , dow] = parts;

  // Every day at specific time
  if (minute !== '*' && hour !== '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayHour = h % 12 || 12;
      const displayMin = m.toString().padStart(2, '0');
      return `Every day at ${displayHour}:${displayMin} ${ampm}`;
    }
  }

  // Every N hours
  if (minute === '0' && hour.startsWith('*/')) {
    const interval = hour.slice(2);
    return `Every ${interval} hours`;
  }

  // Weekdays at specific time
  if (minute !== '*' && hour !== '*' && (dow === '1-5' || dow === 'MON-FRI')) {
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayHour = h % 12 || 12;
      const displayMin = m.toString().padStart(2, '0');
      return `Weekdays at ${displayHour}:${displayMin} ${ampm}`;
    }
  }

  // Monthly on specific day
  const dayOfMonth = parts[2];
  if (minute === '0' && hour === '0' && dayOfMonth !== '*' && dayOfMonth !== undefined) {
    return `Monthly on the ${dayOfMonth}${ordinalSuffix(parseInt(dayOfMonth, 10))}`;
  }

  return expr;
}

function ordinalSuffix(n: number): string {
  if (isNaN(n)) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

export const CronExpression: Component<CronExpressionProps> = (props) => {
  const readable = createMemo(() => parseCronHuman(props.expression));

  return (
    <div class={styles.cronExpression}>
      <code class={styles.raw}>{props.expression}</code>
      <Show when={readable() !== props.expression}>
        <span class={styles.arrow}>&rarr;</span>
        <span class={styles.human}>{readable()}</span>
      </Show>
    </div>
  );
};
