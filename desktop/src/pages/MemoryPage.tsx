import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { MemoryView } from '@/features/memory/MemoryView.js';

export const MemoryPage: Component = () => (
  <ModuleLayout title="Memory" description="Persistent memory and user profiles">
    <MemoryView />
  </ModuleLayout>
);

export default MemoryPage;
