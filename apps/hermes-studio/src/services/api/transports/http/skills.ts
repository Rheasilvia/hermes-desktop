import type { HttpClient } from '../../http-client';
import type { SkillInfo, SkillsToolset } from '../../types';

export interface SkillsTransport {
  listSkills(): Promise<{ items: SkillInfo[]; error?: string; detail?: string }>;
  toggleSkill(name: string, enabled: boolean): Promise<{ ok: boolean; name: string; enabled: boolean; error?: string }>;
  listToolsets(): Promise<{ items: SkillsToolset[]; error?: string; detail?: string }>;
}

export function makeSkillsTransport(client: HttpClient): SkillsTransport {
  return {
    listSkills: () => client.get<{ items: SkillInfo[] }>('/desktop/api/skills'),
    toggleSkill: (name, enabled) =>
      client.put<{ ok: boolean; name: string; enabled: boolean }>(
        '/desktop/api/skills/toggle',
        { name, enabled },
      ),
    listToolsets: () => client.get<{ items: SkillsToolset[] }>('/desktop/api/toolsets'),
  };
}
