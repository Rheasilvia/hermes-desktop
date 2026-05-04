import type { Component } from 'solid-js';
import { createSignal, createMemo, onMount, Show, Switch, Match } from 'solid-js';
import type { CronJob, CreateCronJobParams } from '@/types/cron.js';
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

const EXTRA_MOCK_JOBS: CronJob[] = [
  {
    id: 'cron_def',
    name: 'Weekly code review',
    prompt: 'Review all PRs opened this week and summarize key changes.',
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: { kind: 'cron', expr: '0 10 * * 1', display: 'Mondays at 10:00' },
    schedule_display: 'Mondays at 10:00',
    repeat: { times: null, completed: 0 },
    enabled: false,
    state: 'paused',
    paused_at: new Date(Date.now() - 86400000).toISOString(),
    paused_reason: 'Paused by user',
    created_at: new Date(Date.now() - 86400000 * 14).toISOString(),
    next_run_at: null,
    last_run_at: new Date(Date.now() - 86400000 * 2).toISOString(),
    last_status: 'ok',
    last_error: null,
    last_delivery_error: null,
    deliver: 'local',
    origin: null,
  },
  {
    id: 'cron_ghi',
    name: 'Hourly health check',
    prompt: 'Check all system services and report any issues.',
    skills: [],
    skill: null,
    model: 'anthropic/claude-sonnet-4',
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: { kind: 'cron', expr: '0 */6 * * *', display: 'Every 6 hours' },
    schedule_display: 'Every 6 hours',
    repeat: { times: null, completed: 0 },
    enabled: true,
    state: 'running',
    paused_at: null,
    paused_reason: null,
    created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
    next_run_at: new Date(Date.now() + 21600000).toISOString(),
    last_run_at: new Date(Date.now() - 3600000).toISOString(),
    last_status: 'ok',
    last_error: null,
    last_delivery_error: null,
    deliver: 'origin',
    origin: null,
  },
  {
    id: 'cron_jkl',
    name: 'Nightly backup',
    prompt: 'Backup all project files and database snapshots to cloud storage.',
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: { kind: 'cron', expr: '30 8 * * 1-5', display: 'Weekdays at 08:30' },
    schedule_display: 'Weekdays at 08:30',
    repeat: { times: 10, completed: 7 },
    enabled: true,
    state: 'scheduled',
    paused_at: null,
    paused_reason: null,
    created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
    next_run_at: new Date(Date.now() + 43200000).toISOString(),
    last_run_at: new Date(Date.now() - 86400000).toISOString(),
    last_status: 'ok',
    last_error: null,
    last_delivery_error: null,
    deliver: 'local',
    origin: null,
  },
  {
    id: 'cron_mno',
    name: 'Monthly report',
    prompt: 'Generate monthly metrics report and deliver to stakeholders.',
    skills: [],
    skill: null,
    model: null,
    provider: null,
    base_url: null,
    api_key: null,
    script: null,
    schedule: { kind: 'cron', expr: '0 0 1 * *', display: 'Monthly on the 1st' },
    schedule_display: 'Monthly on the 1st',
    repeat: { times: 12, completed: 12 },
    enabled: false,
    state: 'completed',
    paused_at: null,
    paused_reason: null,
    created_at: new Date(Date.now() - 86400000 * 365).toISOString(),
    next_run_at: null,
    last_run_at: new Date(Date.now() - 86400000 * 30).toISOString(),
    last_status: 'ok',
    last_error: null,
    last_delivery_error: null,
    deliver: 'origin',
    origin: null,
  },
];

const TABS = [
  { id: 'all', label: 'All Jobs' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'delivery', label: 'Delivery' },
  { id: 'history', label: 'History' },
];

export const CronView: Component = () => {
  const [jobs, setJobs] = createSignal<CronJob[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [activeTab, setActiveTab] = createSignal('all');
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  const [showCreateForm, setShowCreateForm] = createSignal(false);

  onMount(async () => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const list = await gateway.cron.list();
        const allJobs = list.length > 0 ? [...list, ...EXTRA_MOCK_JOBS] : EXTRA_MOCK_JOBS;
        setJobs(allJobs);
      } catch {
        setJobs(EXTRA_MOCK_JOBS);
      }
    } else {
      setJobs(EXTRA_MOCK_JOBS);
    }
    setLoading(false);
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
        const created = await gateway.cron.create(params);
        setJobs((prev) => [...prev, created]);
      } catch {
        const mock: CronJob = {
          id: `cron_${Date.now()}`,
          name: params.name ?? 'Untitled job',
          prompt: params.prompt,
          skills: params.skills ?? [],
          skill: params.skill ?? null,
          model: params.model ?? null,
          provider: params.provider ?? null,
          base_url: params.base_url ?? null,
          api_key: null,
          script: params.script ?? null,
          schedule: { kind: 'cron', expr: params.schedule, display: params.schedule },
          schedule_display: params.schedule,
          repeat: { times: params.repeat ?? null, completed: 0 },
          enabled: true,
          state: 'scheduled',
          paused_at: null,
          paused_reason: null,
          created_at: new Date().toISOString(),
          next_run_at: null,
          last_run_at: null,
          last_status: null,
          last_error: null,
          last_delivery_error: null,
          deliver: params.deliver ?? 'origin',
          origin: null,
        };
        setJobs((prev) => [...prev, mock]);
      }
    } else {
      const mock: CronJob = {
        id: `cron_${Date.now()}`,
        name: params.name ?? 'Untitled job',
        prompt: params.prompt,
        skills: params.skills ?? [],
        skill: params.skill ?? null,
        model: params.model ?? null,
        provider: params.provider ?? null,
        base_url: params.base_url ?? null,
        api_key: null,
        script: params.script ?? null,
        schedule: { kind: 'cron', expr: params.schedule, display: params.schedule },
        schedule_display: params.schedule,
        repeat: { times: params.repeat ?? null, completed: 0 },
        enabled: true,
        state: 'scheduled',
        paused_at: null,
        paused_reason: null,
        created_at: new Date().toISOString(),
        next_run_at: null,
        last_run_at: null,
        last_status: null,
        last_error: null,
        last_delivery_error: null,
        deliver: params.deliver ?? 'origin',
        origin: null,
      };
      setJobs((prev) => [...prev, mock]);
    }
    setShowCreateForm(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    const gateway = getGateway();
    if (gateway) {
      try {
        const updated = await gateway.cron.update(id, { enabled });
        setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
      } catch {
        setJobs((prev) =>
          prev.map((j) =>
            j.id === id
              ? { ...j, enabled, state: enabled ? 'scheduled' : 'paused' }
              : j
          )
        );
      }
    } else {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? { ...j, enabled, state: enabled ? 'scheduled' : 'paused' }
            : j
        )
      );
    }
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
    setJobs((prev) => prev.filter((j) => j.id !== id));
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
