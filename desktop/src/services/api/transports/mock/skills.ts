import type { SkillsTransport } from '../http/skills';

export function makeMockSkillsTransport(): SkillsTransport {
  return {
    listSkills: async () => ({ items: [] }),
    toggleSkill: async (name, enabled) => ({ ok: true, name, enabled }),
    listToolsets: async () => ({ items: [] }),
  };
}
