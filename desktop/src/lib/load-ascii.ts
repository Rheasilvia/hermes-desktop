import asciiRaw from '../assets/hermes-ascii.txt?raw';

export const HERMES_ASCII: readonly string[] = asciiRaw
  .split('\n')
  .filter((line) => line.trim().length > 0);
