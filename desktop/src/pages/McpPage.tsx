import type { Component } from 'solid-js';
import { ModuleLayout } from '@/shell/ModuleLayout';
import { McpView } from '@/features/mcp/index.js';

export const McpPage: Component = () => (
  <ModuleLayout title="MCP" description="Model Context Protocol servers">
    <McpView />
  </ModuleLayout>
);

export default McpPage;
