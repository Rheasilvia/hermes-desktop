import { Component, lazy, Suspense, onMount } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import '@/styles/global.css';
import { AppLayout } from '@/layouts/AppLayout';
import { ModuleErrorBoundary } from '@/components/ModuleErrorBoundary';
import { LoadingSpinner } from '@/components/LoadingSpinner';
import { initTheme } from '@/services/theme.js';
import { loadDesktopSettings, applyDesktopSettings } from '@/services/desktop-settings.js';

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
    await initTheme();
    try {
      const desktop = await loadDesktopSettings();
      applyDesktopSettings(desktop);
    } catch {
      // If desktop settings fail to load, theme is already initialised
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
