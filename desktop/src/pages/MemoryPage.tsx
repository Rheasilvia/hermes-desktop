import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { MemoryManagerView } from '@/features/memory/MemoryManagerView.js';

export const MemoryPage: Component = () => (
  <ModuleLayout title="Memory" description="Per-user and per-project memory files">
    <MemoryManagerView />
  </ModuleLayout>
);

export default MemoryPage;
