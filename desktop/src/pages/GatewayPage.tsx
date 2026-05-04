import { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { GatewayView } from '@/modules/gateway/GatewayView.js';

export const GatewayPage: Component = () => (
  <ModuleLayout title="Gateway" description="Messaging platform integrations">
    <GatewayView />
  </ModuleLayout>
);

export default GatewayPage;
