import type { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout.js';
import { CronView } from '@/modules/cron/index.js';

export const CronPage: Component = () => (
  <ModuleLayout title="Cron" description="Scheduled automation tasks">
    <CronView />
  </ModuleLayout>
);

export default CronPage;
