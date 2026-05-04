import type { Component } from 'solid-js';
import { ModuleLayout } from '@/layouts/ModuleLayout';
import { McpView } from '@/modules/mcp/index.js';

export const McpPage: Component = () => (
  <ModuleLayout title="MCP" description="Model Context Protocol servers">
    <McpView />
  </ModuleLayout>
);

export default McpPage;
