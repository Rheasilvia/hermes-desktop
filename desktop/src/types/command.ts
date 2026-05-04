/**
 * Command types matching CommandDef from hermes_cli/commands.py.
 * @source hermes_cli/commands.py
 */

/** Command category. */
export type CommandCategory = 'Session' | 'Configuration' | 'Tools & Skills' | 'Info' | 'Exit';

/** Subcommand definition. */
export interface CommandSubcommand {
  name: string;
  description: string;
  args_hint?: string;
}

/** Command definition matching CommandDef dataclass. */
export interface CommandDef {
  name: string;
  description: string;
  category: CommandCategory;
  aliases?: string[];
  args_hint?: string;
  subcommands?: CommandSubcommand[];
  cli_only?: boolean;
  gateway_only?: boolean;
  gateway_config_gate?: string;
}

/** Catalog of commands by category. */
export interface CommandCatalog {
  categories: CommandCategory[];
  commands: Record<CommandCategory, CommandDef[]>;
}
