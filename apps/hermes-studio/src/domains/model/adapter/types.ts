export const DESKTOP_MODELS_FILE = 'desktop/models.json';
export const DESKTOP_MODELS_SCHEMA_VERSION = 1;

export interface DesktopModelRecord {
  enabled: boolean;
}

export interface DesktopProviderRecord {
  base_url?: string;
  api_key?: string;
  api_key_env?: string | null;
  display_name?: string;
  enabled: boolean;
  models: Record<string, DesktopModelRecord>;
  _meta: {
    last_modified_at: string;
    is_builtin: boolean;
  };
}

export interface DesktopModelsFile {
  version: typeof DESKTOP_MODELS_SCHEMA_VERSION;
  providers: Record<string, DesktopProviderRecord>;
}

export interface UpsertInput {
  name: string;
  is_builtin: boolean;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  display_name?: string;
}

export interface FsAdapter {
  readText(relPath: string): Promise<string | null>;
  writeText(relPath: string, content: string): Promise<void>;
  rename(relPath: string, newRelPath: string): Promise<void>;
}

export interface SetActiveModelResult {
  warning?: string;
}

export interface FallbackTarget {
  provider: string;
  model: string;
}
