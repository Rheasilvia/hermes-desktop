import { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { MemoryView } from '@/modules/memory/MemoryView.js';

export const MemoryPage: Component = () => (
  <ModuleLayout title="Memory" description="Persistent memory and user profiles">
    <MemoryView />
  </ModuleLayout>
);

export default MemoryPage;
