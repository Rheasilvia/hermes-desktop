import type { CardType } from '@/types/command-card.js';
import type { CardModule } from './types.js';
import { SessionsCard } from './SessionsCard.js';
import { ToolsCard, SkillsCard, CronCard, PluginsCard, MemoryCard, AgentsCard, HelpCard } from './ListCards.js';
import { StatusCard, ModelCard, ConfigCard, PlatformsCard, UsageCard } from './InfoCards.js';
import { OutputCard, LogsCard, AccountCard, NoticeCard } from './TextCards.js';

/**
 * Single source of truth: CardType → card component + chrome metadata.
 * `satisfies Record<CardType, CardModule>` makes a missing renderer a compile
 * error, so adding a CardType forces registering a card here.
 */
export const cardRegistry = {
  sessions: { icon: 'clock', title: 'Recent sessions', Component: SessionsCard },
  tools: { icon: 'wrench', title: 'Tools', Component: ToolsCard },
  skills: { icon: 'zap', title: 'Skills', Component: SkillsCard },
  cron: { icon: 'clock', title: 'Scheduled jobs', Component: CronCard },
  plugins: { icon: 'plug', title: 'MCP plugins', Component: PluginsCard },
  memory: { icon: 'brain', title: 'Memory', Component: MemoryCard },
  platforms: { icon: 'wifi', title: 'Gateway', Component: PlatformsCard },
  logs: { icon: 'file-text', title: 'Logs', Component: LogsCard },
  agents: { icon: 'users', title: 'Active agents', Component: AgentsCard },
  usage: { icon: 'bar-chart', title: 'Usage', Component: UsageCard },
  status: { icon: 'info', title: 'Session status', Component: StatusCard },
  model: { icon: 'cpu', title: 'Model', Component: ModelCard },
  config: { icon: 'settings', title: 'Configuration', Component: ConfigCard },
  help: { icon: 'terminal', title: 'Commands', Component: HelpCard },
  account: { icon: 'user', title: 'Account', Component: AccountCard },
  output: { icon: 'terminal', title: 'Output', Component: OutputCard },
  notice: { icon: 'alert-circle', title: 'Not available', Component: NoticeCard },
} satisfies Record<CardType, CardModule>;
