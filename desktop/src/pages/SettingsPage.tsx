import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { SettingsView } from '@/features/settings/index.js';

export const SettingsPage: Component = () => (
  <ModuleLayout title="Settings" description="Application preferences">
    <SettingsView />
  </ModuleLayout>
);

export default SettingsPage;
