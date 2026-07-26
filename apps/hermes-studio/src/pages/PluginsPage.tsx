import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { PluginsView } from '@/features/plugins/PluginsView.js';

export const PluginsPage: Component = () => (
  <ModuleLayout
    title="Plugins"
    description="Manage agent plugins, dashboard extensions, and provider integrations."
  >
    <PluginsView />
  </ModuleLayout>
);

export default PluginsPage;
