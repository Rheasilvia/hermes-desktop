/**
 * Model types matching hermes_cli/models.py.
 */

/** Provider entry in model registry. */
export interface ProviderEntry {
  name: string;
  display_name?: string;
  base_url?: string;
  api_key?: string;
  api_key_env?: string;
  api_key_set?: boolean;
  api_key_preview?: string;
  api_key_source?: string;
  base_url_source?: string;
  has_overlay?: boolean;
  enabled?: boolean;
  is_builtin?: boolean;
  models?: ModelOption[];
}

/** Model option within a provider. */
export interface ModelOption {
  name: string;
  display_name?: string;
  context_length?: number;
  supports_vision?: boolean;
  supports_function_calling?: boolean;
  supports_streaming?: boolean;
  default_temperature?: number;
  default_max_tokens?: number;
  pricing_input?: number;
  pricing_output?: number;
  enabled?: boolean;
}
