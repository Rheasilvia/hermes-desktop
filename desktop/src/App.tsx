import { Component, lazy, Suspense, createSignal, Switch, Match } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import '@/styles/global.css';
import { AppLayout } from '@/shell/AppLayout';
import { ModuleErrorBoundary } from '@/shell/ModuleErrorBoundary';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner';
import { initializeStores } from '@/stores/context.js';
import { createHttpGateway } from '@/services/gateway/index.js';
import type { GatewayAdapter } from '@/services/gateway/types.js';
import { initBootstrap } from '@/shell/bootstrap.js';
import { modelsStore } from '@/stores/models.js';
import styles from './App.module.css';

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

async function waitForBackend(gateway: GatewayAdapter, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await gateway.session.list();
      return;
    } catch {
      await new Promise<void>(r => setTimeout(r, 1_000));
    }
  }
  throw new Error('Could not connect to the Hermes backend. Make sure it is running and try again.');
}

const App: Component = () => {
  const [bootState, setBootState] = createSignal<'booting' | 'ready' | 'error'>('booting');
  const [bootError, setBootError] = createSignal('');

  const boot = async () => {
    setBootState('booting');
    setBootError('');
    try {
      const gateway = createHttpGateway();
      initializeStores(gateway);
      await initBootstrap();
      await waitForBackend(gateway, 30_000);
      await gateway.connect();
      // Fire-and-forget: catalog + active model load in the background so the
      // shell renders immediately. localStorage cache hydrates the picker
      // instantly; stale flag ensures a background refetch on first access.
      void Promise.all([modelsStore.load(), modelsStore.loadActive()]);
      setBootState('ready');
    } catch (e) {
      setBootError(e instanceof Error ? e.message : 'Could not connect to the Hermes backend.');
      setBootState('error');
    }
  };
  void boot();

  return (
    <Switch>
      <Match when={bootState() === 'ready'}>
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
      </Match>
      <Match when={bootState() === 'error'}>
        <div class={styles.bootScreen}>
          <p class={styles.bootErrorMsg}>{bootError()}</p>
          <button class={styles.bootRetryBtn} onClick={() => void boot()}>Retry</button>
        </div>
      </Match>
      <Match when={true}>
        <div class={styles.bootScreen}>
          <LoadingSpinner size="lg" label="Starting Hermes..." />
        </div>
      </Match>
    </Switch>
  );
};

export default App;
