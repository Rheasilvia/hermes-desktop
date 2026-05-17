import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { SkillsView } from '@/features/skills/SkillsView.js';

export const SkillsPage: Component = () => (
  <ModuleLayout title="Skills" description="Manage agent skills">
    <SkillsView />
  </ModuleLayout>
);

export default SkillsPage;
