import { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { SettingsView } from '@/modules/settings/index.js';

export const SettingsPage: Component = () => (
  <ModuleLayout title="Settings" description="Application preferences">
    <SettingsView />
  </ModuleLayout>
);

export default SettingsPage;
