import type { Component } from 'solid-js';
import { createSignal, onMount, onCleanup } from 'solid-js';
import { spinners } from 'unicode-animations';

interface BrailleSpinnerProps {
  name?: 'orbit' | 'braille' | 'helix' | 'scan' | 'pulse' | 'clock' | 'moon' | 'earth' | 'dots' | 'line' | 'bouncingBall' | 'arc' | 'circle' | 'square' | 'diamond' | 'arrow' | 'triangle' | 'zigzag';
  size?: number;
  class?: string;
}

export const BrailleSpinner: Component<BrailleSpinnerProps> = (props) => {
  const [frame, setFrame] = createSignal(0);
  let timer: ReturnType<typeof setInterval>;

  onMount(() => {
    const s = spinners[(props.name ?? 'orbit') as keyof typeof spinners];
    if (!s) return;
    timer = setInterval(() => {
      setFrame((f) => (f + 1) % s.frames.length);
    }, s.interval);
  });

  onCleanup(() => {
    if (timer) clearInterval(timer);
  });

  const currentFrame = () => {
    const s = spinners[(props.name ?? 'orbit') as keyof typeof spinners];
    return s?.frames[frame()] ?? '';
  };

  return (
    <span
      class={props.class}
      style={{
        'font-family': 'monospace',
        'font-size': `${props.size ?? 16}px`,
        'line-height': 1,
        'display': 'inline-block',
        'white-space': 'pre',
      }}
    >
      {currentFrame()}
    </span>
  );
};
