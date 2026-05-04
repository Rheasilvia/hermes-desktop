import { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { SkillsView } from '@/modules/skills/SkillsView.js';

export const SkillsPage: Component = () => (
  <ModuleLayout title="Skills" description="Manage agent skills">
    <SkillsView />
  </ModuleLayout>
);

export default SkillsPage;
