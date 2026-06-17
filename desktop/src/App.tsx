import { Component, lazy, Suspense, createSignal, Switch, Match, onMount } from 'solid-js';
import { Router, Route, useNavigate, useParams } from '@solidjs/router';
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
const SettingsPage = lazy(() => import('@/pages/SettingsPage'));

const RedirectRoute: Component<{ to: string }> = (props) => {
  const navigate = useNavigate();
  onMount(() => navigate(props.to, { replace: true }));
  return null;
};

const LegacySessionRedirect: Component = () => {
  const navigate = useNavigate();
  const params = useParams();
  onMount(() => {
    const id = params.id ? `/${params.id}` : '';
    navigate(`/settings/sessions${id}`, { replace: true });
  });
  return null;
};

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
          <Route path="/sessions" component={() => <RedirectRoute to="/settings/sessions" />} />
          <Route path="/sessions/:id" component={LegacySessionRedirect} />
          <Route path="/settings" component={() => (
            <ModuleSuspense moduleName="Settings"><SettingsPage /></ModuleSuspense>
          )} />
          <Route path="/settings/*section" component={() => (
            <ModuleSuspense moduleName="Settings"><SettingsPage /></ModuleSuspense>
          )} />
          <Route path="/model" component={() => <RedirectRoute to="/settings/model" />} />
          <Route path="/skills" component={() => <RedirectRoute to="/settings/skills" />} />
          <Route path="/plugins" component={() => <RedirectRoute to="/settings/plugins" />} />
          <Route path="/mcp" component={() => <RedirectRoute to="/settings/mcp" />} />
          <Route path="/memory" component={() => <RedirectRoute to="/settings/memory" />} />
          <Route path="/gateway" component={() => <RedirectRoute to="/settings/gateway" />} />
          <Route path="/cron" component={() => <RedirectRoute to="/settings/cron" />} />
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
