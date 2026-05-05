import type { Component } from 'solid-js';
import { createSignal, createMemo, onMount, Show, Switch, Match } from 'solid-js';
import type { CreateCronJobParams } from '@/types/cron.js';
import { cronStore } from '../../stores/cron';
import { getGateway } from '@/stores/context.js';
import { Button } from '@/components/Button.js';
import { Tabs } from '@/components/Tabs.js';
import { Modal } from '@/components/Modal.js';
import { LoadingSpinner } from '@/components/LoadingSpinner.js';
import { JobList } from './JobList.js';
import { CreateJobForm } from './CreateJobForm.js';
import { JobDetail } from './JobDetail.js';
import { ExecutionHistory } from './ExecutionHistory.js';
import styles from './CronView.module.css';

const TABS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'history', label: 'History' },
];

export const CronView: Component = () => {
  const loading = cronStore.loading;
  const jobs = cronStore.jobs;
  const error = cronStore.error;
  const [activeTab, setActiveTab] = createSignal('all');
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [showCreateForm, setShowCreateForm] = createSignal(false);

  onMount(() => {
    void cronStore.load();
  });

  const filteredJobs = createMemo(() => {
    const tab = activeTab();
    const all = jobs();
    switch (tab) {
      case 'active':
        return all.filter((j) => j.enabled && j.state !== 'paused');
      case 'paused':
        return all.filter((j) => j.state === 'paused');
      case 'delivery':
        return all;
      case 'history':
        return [];
      default:
        return all;
    }
  });

  const selectedJob = createMemo(() => {
    const id = selectedId();
    if (!id) return null;
    return jobs().find((j) => j.id === id) ?? null;
  });

  const handleCreate = async (params: CreateCronJobParams) => {
    const gateway = getGateway();
    if (gateway) {
      try {
        await gateway.cron.create(params);
      } catch {
        void 0;
      }
    }
    void cronStore.load();
    setShowCreateForm(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const gateway = getGateway();
    if (gateway) {
      try {
        await gateway.cron.update(id, { enabled });
      } catch {
        void 0;
      }
    }
    void cronStore.load();
  };

  const handleDelete = async (id: string) => {
    const gateway = getGateway();
    if (gateway) {
      try {
        await gateway.cron.delete(id);
      } catch {
        void 0;
      }
    }
    void cronStore.load();
    if (selectedId() === id) {
      setSelectedId(null);
    }
  };

  return (
    <div class={styles.cronView}>
      <div class={styles.toolbar}>
        <Tabs tabs={TABS} activeTab={activeTab()} onChange={setActiveTab} />
        <Button variant="primary" size="sm" onClick={() => setShowCreateForm(true)}>
          + New Job
        </Button>
      </div>

      <div class={styles.content}>
        <Show
          when={!loading()}
          fallback={
            <div class={styles.loadingWrap}>
              <LoadingSpinner size="md" />
            </div>
          }
        >
          <Switch>
            <Match when={activeTab() === 'history'}>
              <ExecutionHistory />
            </Match>
            <Match when={activeTab() === 'delivery'}>
              <div class={styles.listPanel}>
                <JobList
                  jobs={filteredJobs()}
                  onSelect={setSelectedId}
                  selectedId={selectedId()}
                />
              </div>
              <Show when={selectedJob()}>
                {(job) => (
                  <div class={styles.detailPanel}>
                    <JobDetail
                      job={job()}
                      onClose={() => setSelectedId(null)}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  </div>
                )}
              </Show>
            </Match>
            <Match when={true}>
              <div class={styles.listPanel}>
                <JobList
                  jobs={filteredJobs()}
                  onSelect={setSelectedId}
                  selectedId={selectedId()}
                />
              </div>
              <Show when={selectedJob()}>
                {(job) => (
                  <div class={styles.detailPanel}>
                    <JobDetail
                      job={job()}
                      onClose={() => setSelectedId(null)}
                      onToggle={handleToggle}
                      onDelete={handleDelete}
                    />
                  </div>
                )}
              </Show>
            </Match>
          </Switch>
        </Show>
      </div>

      <Show when={showCreateForm()}>
        <Modal
          open={showCreateForm()}
          title="Create Cron Job"
          onClose={() => setShowCreateForm(false)}
        >
          <CreateJobForm
            onSubmit={handleCreate}
            onCancel={() => setShowCreateForm(false)}
          />
        </Modal>
      </Show>
    </div>
  );
};
