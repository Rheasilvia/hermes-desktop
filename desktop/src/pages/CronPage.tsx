import type { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout.js';
import { CronView } from '@/features/cron/index.js';

export const CronPage: Component = () => (
  <ModuleLayout title="Cron" description="Scheduled automation tasks">
    <CronView />
  </ModuleLayout>
);

export default CronPage;
