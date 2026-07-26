import type { ProviderEntry, ModelOption } from '@/types/index.js';
import type { DesktopModelsFile, DesktopProviderRecord } from './types.js';
import { isYamlNewer } from './timestamp.js';

export function mergeProviders(
  yamlProviders: ProviderEntry[],
  desktopData: DesktopModelsFile,
  yamlMtimeSec: number,
  builtInNames: readonly string[],
): ProviderEntry[] {
  const builtInSet = new Set(builtInNames);
  return yamlProviders.map(yamlP => {
    const desktopP: DesktopProviderRecord | undefined = desktopData.providers[yamlP.name];
    const isBuiltin = builtInSet.has(yamlP.name);

    if (!desktopP) {
      return {
        ...yamlP,
        is_builtin: isBuiltin,
        enabled: true,
        models: (yamlP.models ?? []).map(m => ({ ...m, enabled: true })),
      };
    }

    const yamlWins = isYamlNewer(yamlMtimeSec, desktopP._meta.last_modified_at);
    const sharedSrc: ProviderEntry = yamlWins
      ? yamlP
      : {
          ...yamlP,
          base_url: desktopP.base_url ?? yamlP.base_url,
          api_key: desktopP.api_key ?? yamlP.api_key,
          api_key_env: desktopP.api_key_env ?? yamlP.api_key_env ?? undefined,
          display_name: desktopP.display_name ?? yamlP.display_name,
        };

    const mergedModels: ModelOption[] = (yamlP.models ?? []).map(m => {
      const dm = desktopP.models[m.name];
      return { ...m, enabled: dm ? dm.enabled : true };
    });

    return {
      ...sharedSrc,
      is_builtin: isBuiltin || desktopP._meta.is_builtin,
      enabled: desktopP.enabled,
      models: mergedModels,
    };
  });
}
