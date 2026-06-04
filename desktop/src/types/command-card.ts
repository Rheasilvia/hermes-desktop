/**
 * Inline command-card kinds rendered in the command-card dock. Lives in
 * `@/types` (not `@/services/gateway`) so card components can import it without
 * tripping the D7 "no gateway import" lint rule. Mirrors the backend
 * `CardType` Literal in `daemon/schemas/commands.py`.
 */
export type CardType = 'notice';
