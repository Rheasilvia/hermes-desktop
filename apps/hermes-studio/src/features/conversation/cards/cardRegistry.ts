import type { CardType } from '@/types/command-card.js';
import type { CardModule } from './types.js';
import { NoticeCard } from './TextCards.js';

/**
 * Single source of truth: CardType → card component + chrome metadata.
 * `satisfies Record<CardType, CardModule>` makes a missing renderer a compile
 * error, so adding a CardType forces registering a card here.
 *
 * Desktop's slash set is session lifecycle + skills; no command emits a data
 * card anymore, so the dock only renders `notice` (synthesized on the frontend
 * for redirect/unsupported/error/output results — see ChatView).
 */
export const cardRegistry = {
  notice: { icon: 'alert-circle', title: 'Not available', Component: NoticeCard },
} satisfies Record<CardType, CardModule>;
