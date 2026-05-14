import { Component, lazy, Suspense } from 'solid-js';
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

const WelcomePage = lazy(() => import('@/pages/WelcomePage'));
const ConversationPage = lazy(() => import('@/pages/ConversationPage'));
const SessionsPage = lazy(() => import('@/pages/SessionsPage'));
const SessionDetailPage = lazy(() => import('@/pages/SessionDetailPage'));
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));
const ModelPage = lazy(() => import('@/pages/ModelPage'));
const SkillsPage = lazy(() => import('@/pages/SkillsPage'));
const PluginsPage = lazy(() => import('@/pages/PluginsPage'));
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
  // Non-routing setup: theme, settings, gateway, sidecar listeners
  const init = async () => {
    const gateway = createMockGateway();
    initializeStores(gateway);
    await gateway.connect();
    await initTheme();
    try {
      const desktop = await loadDesktopSettings();
      applyDesktopSettings(desktop);
    } catch {
      // theme already initialised
    }
    if (isTauri) {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        await listen('sidecar://ready', () => {
          void cronStore.load();
          void analyticsStore.load();
        });
        try {
          await invoke('sidecar_info');
          void cronStore.load();
          void analyticsStore.load();
        } catch { /* not ready yet */ }
      } catch { /* not in Tauri */ }
    }
  };
  void init();

  return (
    <Router root={AppLayout}>
      <Route path="/" component={() => (
        <ModuleSuspense moduleName="Welcome"><WelcomePage /></ModuleSuspense>
      )} />
      <Route path="/conversation/:id" component={() => (
        <ModuleSuspense moduleName="Conversation"><ConversationPage /></ModuleSuspense>
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
      <Route path="/plugins" component={() => (
        <ModuleSuspense moduleName="Plugins"><PluginsPage /></ModuleSuspense>
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
