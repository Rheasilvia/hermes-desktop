import { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { GatewayView } from '@/features/gateway/GatewayView.js';

export const GatewayPage: Component = () => (
  <ModuleLayout title="Gateway" description="Messaging platform integrations">
    <GatewayView />
  </ModuleLayout>
);

export default GatewayPage;
