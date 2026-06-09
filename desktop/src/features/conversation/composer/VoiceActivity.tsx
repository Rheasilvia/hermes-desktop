import type { Component } from 'solid-js';
import { Show, For } from 'solid-js';
import { Icon } from '@/ui/atoms/Icon.js';
import { voicePlayback } from '@/stores/voice-playback.js';
import { stopVoicePlayback } from '@/lib/voice/voice-playback.js';
import type { VoiceActivityState } from '@/lib/voice/create-voice-recorder.js';
import styles from './VoiceActivity.module.css';

function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const BAR_WEIGHTS = [0.5, 0.78, 1, 0.78, 0.5];

function LevelBars(props: { level: number; active: boolean }) {
  return (
    <div aria-hidden="true" class={styles.levelBars}>
      <For each={BAR_WEIGHTS}>
        {(weight) => {
          const height = () =>
            props.active
              ? 0.25 + Math.min(0.68, props.level * weight)
              : 0.25;
          return (
            <span
              class={`${styles.bar} ${props.active ? styles.barActive : styles.barIdle}`}
              style={{ height: `${height() * 100}%` }}
            />
          );
        }}
      </For>
    </div>
  );
}

export const VoiceActivity: Component<{ state: VoiceActivityState }> = (props) => {
  const recording = () => props.state.status === 'recording';

  return (
    <Show when={props.state.status !== 'idle'}>
      <div class={styles.container} role="status" aria-live="polite">
        <span class={styles.icon}>
          <Show when={recording()} fallback={<Icon name="loader" size={12} />}>
            <Icon name="mic" size={12} />
          </Show>
        </span>
        <span class={styles.label}>{recording() ? 'Recording…' : 'Transcribing…'}</span>
        <span class={styles.elapsed}>{formatElapsed(props.state.elapsedSeconds)}</span>
        <LevelBars level={props.state.level} active={recording()} />
      </div>
    </Show>
  );
};

export const VoicePlaybackActivity: Component = () => {
  const pb = () => voicePlayback();

  return (
    <Show when={pb().status !== 'idle'}>
      <div class={styles.playbackContainer} role="status" aria-live="polite">
        <span class={styles.icon}>
          <Show when={pb().status === 'preparing'} fallback={<Icon name="volume-2" size={12} />}>
            <Icon name="loader" size={12} />
          </Show>
        </span>
        <span class={styles.label}>
          {pb().status === 'preparing'
            ? 'Preparing audio…'
            : pb().source === 'voice-conversation'
            ? 'Speaking response…'
            : 'Reading aloud…'}
        </span>
        <button class={styles.stopBtn} type="button" onClick={stopVoicePlayback}>
          <Icon name="volume-x" size={12} />
          Stop
        </button>
      </div>
    </Show>
  );
};
