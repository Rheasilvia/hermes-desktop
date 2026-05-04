export const ROUTES = {
  HOME: '/',
  SESSIONS: '/sessions',
  SESSION_DETAIL: '/sessions/:id',
  SETTINGS: '/settings',
  MODEL: '/model',
  SKILLS: '/skills',
  MCP: '/mcp',
  MEMORY: '/memory',
  GATEWAY: '/gateway',
  CRON: '/cron',
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];
