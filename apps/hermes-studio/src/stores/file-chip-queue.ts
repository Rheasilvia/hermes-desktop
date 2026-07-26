import { createSignal } from 'solid-js';

export interface FileChip {
  name: string;
  path: string;
}

const [queue, setQueue] = createSignal<FileChip[]>([]);

export const fileChipQueue = {
  pending: queue,
  enqueue: (chip: FileChip) => setQueue(prev => [...prev, chip]),
  flush: (): FileChip[] => { const chips = queue(); setQueue([]); return chips; },
};
