import type { SlashCommand } from './SlashCommandPanel.js';

const CURATED_COMMANDS = new Set([
  '/agents',
  '/background',
  '/branch',
  '/compress',
  '/debug',
  '/goal',
  '/help',
  '/new',
  '/queue',
  '/resume',
  '/retry',
  '/rollback',
  '/skin',
  '/status',
  '/steer',
  '/stop',
  '/title',
  '/undo',
  '/usage',
  '/yolo',
]);

const ALIASES = new Map([
  ['/bg', '/background'],
  ['/btw', '/background'],
  ['/fork', '/branch'],
  ['/q', '/queue'],
  ['/reset', '/new'],
  ['/tasks', '/agents'],
]);

const BLOCKED_COMMANDS = new Set([
  '/approve',
  '/browser',
  '/busy',
  '/clear',
  '/commands',
  '/compact',
  '/config',
  '/copy',
  '/cron',
  '/curator',
  '/deny',
  '/details',
  '/exit',
  '/fast',
  '/footer',
  '/gateway',
  '/gquota',
  '/history',
  '/image',
  '/indicator',
  '/insights',
  '/kanban',
  '/logs',
  '/model',
  '/mouse',
  '/paste',
  '/personality',
  '/platforms',
  '/plugins',
  '/profile',
  '/quit',
  '/reasoning',
  '/redraw',
  '/reload',
  '/reload-mcp',
  '/reload-skills',
  '/restart',
  '/save',
  '/sb',
  '/set-home',
  '/sethome',
  '/skills',
  '/snap',
  '/snapshot',
  '/statusbar',
  '/toolsets',
  '/tools',
  '/update',
  '/verbose',
  '/voice',
]);

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  return (trimmed.startsWith('/') ? trimmed : `/${trimmed}`).split(/\s+/, 1)[0]?.toLowerCase() ?? '';
}

function canonicalCommand(command: string): string {
  const normalized = normalizeCommand(command);
  return ALIASES.get(normalized) ?? normalized;
}

function isKnownBuiltIn(command: string): boolean {
  const normalized = normalizeCommand(command);
  const canonical = canonicalCommand(normalized);
  return CURATED_COMMANDS.has(canonical) || ALIASES.has(normalized) || BLOCKED_COMMANDS.has(normalized) || BLOCKED_COMMANDS.has(canonical);
}

export function isDesktopSlashExtensionCommand(command: string): boolean {
  const normalized = normalizeCommand(command);
  return Boolean(normalized && normalized !== '/' && !isKnownBuiltIn(normalized));
}

export function isDesktopSlashSuggestion(command: string): boolean {
  const normalized = normalizeCommand(command);
  const canonical = canonicalCommand(normalized);
  if (isDesktopSlashExtensionCommand(normalized)) return true;
  return CURATED_COMMANDS.has(canonical) && !ALIASES.has(normalized);
}

export function filterDesktopSlashCommands(commands: SlashCommand[]): SlashCommand[] {
  return commands.filter((cmd) => isDesktopSlashSuggestion(cmd.command));
}
