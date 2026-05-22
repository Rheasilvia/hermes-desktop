import { Component, lazy, Suspense } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import '@/styles/global.css';
import { AppLayout } from '@/shell/AppLayout';
import { ModuleErrorBoundary } from '@/shell/ModuleErrorBoundary';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import { initializeStores } from '@/stores/context.js';
import { createMockGateway, createHttpGateway } from '@/services/gateway/index.js';
import { initBootstrap } from '@/shell/bootstrap.js';
import { modelsStore } from '@/stores/models.js';

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
  const init = async () => {
    const mode = import.meta.env.VITE_GATEWAY_MODE ?? 'http';
    const gateway = mode === 'mock'
      ? createMockGateway()
      : createHttpGateway();
    initializeStores(gateway);
    await gateway.connect();
    await initBootstrap();
    await modelsStore.loadActive();
  };
  void init();

  return (
    <Router root={AppLayout}>
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
