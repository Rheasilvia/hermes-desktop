import { Component, lazy, Suspense, onMount } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import '@/styles/global.css';
import { AppLayout } from '@/layouts/AppLayout';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { initTheme } from '@/services/theme.js';
import { loadDesktopSettings, applyDesktopSettings } from '@/services/desktop-settings.js';
import { initializeStores } from '@/stores/context.js';
import { createMockGateway } from '@/services/gateway/index.js';
import { cronStore } from '@/stores/cron.js';
import { analyticsStore } from '@/stores/analytics.js';

const isTauri = typeof window !== 'undefined' && !!(window as unknown as { __TAURI__?: unknown }).__TAURI__;

const ChatPage = lazy(() => import('@/pages/ChatPage'));
const SessionsPage = lazy(() => import('@/pages/SessionsPage'));
const SessionDetailPage = lazy(() => import('@/pages/SessionDetailPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ModelPage = lazy(() => import('@/pages/ModelPage'));
const SkillsPage = lazy(() => import('@/pages/SkillsPage'));
const McpPage = lazy(() => import('@/pages/McpPage'));
const MemoryPage = lazy(() => import('@/pages/MemoryPage'));
const GatewayPage = lazy(() => import('@/pages/GatewayPage'));
const CronPage = lazy(() => import('@/pages/CronPage'));

const ModuleSuspense: Component<{ moduleName: string; children: any }> = (props) => (
  <ModuleErrorBoundary moduleName={props.moduleName}>
    <Suspense fallback={<LoadingSpinner size="lg" label={`Loading ${props.moduleName}...`} />}>
      {props.children}
    </Suspense>
  </ModuleErrorBoundary>
);

const App: Component = () => {
  onMount(async () => {
    if (!isTauri) {
      const gateway = createMockGateway();
      initializeStores(gateway);
      await gateway.connect();
    }
    await initTheme();
    try {
      const desktop = await loadDesktopSettings();
      applyDesktopSettings(desktop);
    } catch {
      // If desktop settings fail to load, theme is already initialised
    }
    if (isTauri) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        // Listen for future ready events (prod: sidecar takes ~5s to start)
        await listen('sidecar://ready', () => {
          void cronStore.load();
          void analyticsStore.load();
        });
        // Also check if already ready (dev: event fires before listener registers)
        try {
          await invoke('sidecar_info');
          void cronStore.load();
          void analyticsStore.load();
        } catch { /* not ready yet, listener will handle it */ }
      } catch { /* not in Tauri */ }
    }
  });

  return (
    <Router root={AppLayout}>
      <Route path="/" component={() => (
        <ModuleSuspense moduleName="Chat"><ChatPage /></ModuleSuspense>
      )} />
      <Route path="/sessions" component={() => (
        <ModuleSuspense moduleName="Sessions"><SessionsPage /></ModuleSuspense>
      )} />
      <Route path="/sessions/:id" component={() => (
        <ModuleSuspense moduleName="Session Detail"><SessionDetailPage /></ModuleSuspense>
      )} />
      <Route path="/settings" component={() => (
        <ModuleSuspense moduleName="Settings"><SettingsPage /></ModuleSuspense>
      )} />
      <Route path="/model" component={() => (
        <ModuleSuspense moduleName="Model"><ModelPage /></ModuleSuspense>
      )} />
      <Route path="/skills" component={() => (
        <ModuleSuspense moduleName="Skills"><SkillsPage /></ModuleSuspense>
      )} />
      <Route path="/mcp" component={() => (
        <ModuleSuspense moduleName="MCP"><McpPage /></ModuleSuspense>
      )} />
      <Route path="/memory" component={() => (
        <ModuleSuspense moduleName="Memory"><MemoryPage /></ModuleSuspense>
      )} />
      <Route path="/gateway" component={() => (
        <ModuleSuspense moduleName="Gateway"><GatewayPage /></ModuleSuspense>
      )} />
      <Route path="/cron" component={() => (
        <ModuleSuspense moduleName="Cron"><CronPage /></ModuleSuspense>
      )} />
    </Router>
  );
};

export default App;
