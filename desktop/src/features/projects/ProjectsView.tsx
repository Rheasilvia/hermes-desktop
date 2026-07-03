import type { Component } from 'solid-js';
import { createSignal, createMemo, onMount, Show, For } from 'solid-js';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '@tauri-apps/api/core';
import type { WorktreeEntry } from '@/types/index.js';
import { projectStore } from '@/stores/projects.js';
import { Button } from '@/ui/atoms/Button.js';
import { Icon } from '@/ui/atoms/Icon.js';
import { Badge } from '@/ui/atoms/Badge.js';
import { Pill } from '@/ui/atoms/Pill.js';
import { Input } from '@/ui/atoms/Input.js';
import { Select } from '@/ui/atoms/Select.js';
import { Toggle } from '@/ui/atoms/Toggle.js';
import { LoadingSpinner } from '@/ui/atoms/LoadingSpinner.js';
import { Modal } from '@/ui/molecules/Modal.js';
import { EmptyState } from '@/ui/molecules/EmptyState.js';
import styles from './ProjectsView.module.css';

/** Extract the base directory name from a path. */
function baseName(path: string): string {
  return path
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .filter(Boolean)
    .pop() ?? path;
}

export const ProjectsView: Component = () => {
  const [selectedPath, setSelectedPath] = createSignal<string | null>(null);

  // Add-project modal
  const [addProjectOpen, setAddProjectOpen] = createSignal(false);
  const [projectPath, setProjectPath] = createSignal('');
  const [projectName, setProjectName] = createSignal('');

  // Add-worktree modal
  const [addWorktreeOpen, setAddWorktreeOpen] = createSignal(false);
  const [worktreePath, setWorktreePath] = createSignal('');
  const [worktreeBranch, setWorktreeBranch] = createSignal('');
  const [worktreeCreateBranch, setWorktreeCreateBranch] = createSignal(false);

  // Remove-worktree confirmation modal
  const [removeTarget, setRemoveTarget] = createSignal<WorktreeEntry | null>(null);

  onMount(() => {
    void projectStore.load();
  });

  const selectedProject = createMemo(() => {
    const path = selectedPath();
    if (!path) return null;
    return projectStore.projects().find((p) => p.path === path) ?? null;
  });

  const branchOptions = createMemo(() =>
    (projectStore.branches()?.branches ?? []).map((b) => ({ value: b, label: b })),
  );

  const handleSelectProject = (path: string) => {
    setSelectedPath(path);
    void projectStore.loadWorktrees(path);
  };

  const pickDirectory = async (setter: (value: string) => void) => {
    if (!isTauri()) return;
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === 'string') setter(selected);
  };

  const handleAddProject = async () => {
    const path = projectPath().trim();
    if (!path) return;
    const name = projectName().trim();
    await projectStore.addProject(path, name || undefined);
    setAddProjectOpen(false);
    setProjectPath('');
    setProjectName('');
  };

  const handleAddWorktree = async () => {
    const repoPath = selectedPath();
    const path = worktreePath().trim();
    const branch = worktreeBranch().trim();
    if (!repoPath || !path || !branch) return;
    await projectStore.addWorktree({
      repoPath,
      path,
      branch,
      createBranch: worktreeCreateBranch(),
    });
    setAddWorktreeOpen(false);
    setWorktreePath('');
    setWorktreeBranch('');
    setWorktreeCreateBranch(false);
  };

  const handleRemoveWorktree = async () => {
    const repoPath = selectedPath();
    const target = removeTarget();
    if (!repoPath || !target) return;
    await projectStore.removeWorktree({ repoPath, path: target.path });
    setRemoveTarget(null);
  };

  const handleSwitchBranch = (branch: string) => {
    const repoPath = selectedPath();
    if (!repoPath || !branch) return;
    void projectStore.switchBranch({ repoPath, path: repoPath, branch });
  };

  return (
    <div class={styles.projectsView}>
      <div class={styles.header}>
        <h1 class={styles.title}>Projects</h1>
        <Button onClick={() => setAddProjectOpen(true)}>
          <Icon name="plus" size={14} />
          <span>Add project</span>
        </Button>
      </div>

      <Show when={projectStore.error()}>
        <div class={styles.errorBanner}>{projectStore.error()}</div>
      </Show>

      <Show
        when={!projectStore.loading()}
        fallback={
          <div class={styles.loadingWrap}>
            <LoadingSpinner size="lg" label="Loading projects..." />
          </div>
        }
      >
        <Show
          when={projectStore.projects().length > 0}
          fallback={
            <EmptyState
              iconName="folder"
              title="No projects yet"
              description="Add a git repository to manage its branches and worktrees."
              action={
                <Button onClick={() => setAddProjectOpen(true)}>
                  <Icon name="plus" size={14} />
                  <span>Add project</span>
                </Button>
              }
            />
          }
        >
          <div class={styles.content}>
            {/* ── Left: project list ─────────────────────────────── */}
            <div class={styles.listPanel}>
              <For each={projectStore.projects()}>
                {(project) => (
                  <button
                    type="button"
                    class={`${styles.projectRow} ${selectedPath() === project.path ? styles.projectRowActive : ''}`}
                    onClick={() => handleSelectProject(project.path)}
                  >
                    <div class={styles.projectInfo}>
                      <span class={styles.projectName}>{project.name}</span>
                      <span class={styles.projectPath} title={project.path}>{project.path}</span>
                    </div>
                    <div class={styles.projectMeta}>
                      <Show when={project.path === projectStore.activePath()}>
                        <Badge status="active" />
                      </Show>
                      <Show when={project.path !== projectStore.activePath()}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            void projectStore.setActiveProject(project.path);
                          }}
                        >
                          Set active
                        </Button>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </div>

            {/* ── Right: worktree / branch detail ────────────────── */}
            <Show
              when={selectedProject()}
              fallback={
                <div class={styles.detailPlaceholder}>
                  <EmptyState
                    iconName="git-branch"
                    title="Select a project"
                    description="Choose a project on the left to view its branches and worktrees."
                  />
                </div>
              }
            >
              <div class={styles.detailPanel}>
                {/* Branch */}
                <div class={styles.section}>
                  <div class={styles.sectionHeader}>
                    <h2 class={styles.sectionTitle}>Branch</h2>
                  </div>
                  <div class={styles.branchRow}>
                    <span class={styles.branchCurrent}>
                      <Icon name="git-branch" size={13} /> {projectStore.branches()?.current ?? '—'}
                    </span>
                    <Show when={branchOptions().length > 0}>
                      <Select
                        options={branchOptions()}
                        value={projectStore.branches()?.current}
                        placeholder="Switch branch"
                        onChange={handleSwitchBranch}
                      />
                    </Show>
                  </div>
                </div>

                {/* Worktrees */}
                <div class={styles.section}>
                  <div class={styles.sectionHeader}>
                    <h2 class={styles.sectionTitle}>Worktrees</h2>
                    <Button variant="secondary" size="sm" onClick={() => setAddWorktreeOpen(true)}>
                      <Icon name="plus" size={13} />
                      <span>Add worktree</span>
                    </Button>
                  </div>
                  <Show
                    when={(projectStore.worktrees()?.worktrees ?? []).length > 0}
                    fallback={
                      <EmptyState iconName="folder" title="No worktrees" />
                    }
                  >
                    <div class={styles.worktreeList}>
                      <For each={projectStore.worktrees()?.worktrees ?? []}>
                        {(wt) => (
                          <div class={styles.worktreeRow}>
                            <div class={styles.worktreeInfo}>
                              <span class={styles.worktreePath} title={wt.path}>{wt.path}</span>
                              <div class={styles.worktreeBadges}>
                                <Show when={wt.branch}>
                                  <span class={styles.worktreeBranch}>
                                    <Icon name="git-branch" size={11} /> {wt.branch}
                                  </span>
                                </Show>
                                <Show when={wt.bare}>
                                  <Pill variant="outline">bare</Pill>
                                </Show>
                                <Show when={wt.detached}>
                                  <Pill variant="outline">detached</Pill>
                                </Show>
                              </div>
                            </div>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setRemoveTarget(wt)}
                            >
                              <Icon name="trash-2" size={13} />
                              <span>Remove</span>
                            </Button>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </Show>
      </Show>

      {/* ── Add-project modal ──────────────────────────────────────── */}
      <Modal
        open={addProjectOpen()}
        title="Add project"
        onClose={() => setAddProjectOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddProjectOpen(false)}>Cancel</Button>
            <Button onClick={handleAddProject} disabled={!projectPath().trim()}>Add</Button>
          </>
        }
      >
        <div class={styles.modalForm}>
          <Input
            label="Repository path"
            value={projectPath()}
            placeholder="/path/to/repo"
            onInput={(e) => setProjectPath(e.currentTarget.value)}
          />
          <Show when={isTauri()}>
            <Button variant="secondary" size="sm" onClick={() => void pickDirectory(setProjectPath)}>
              <Icon name="folder-open" size={13} />
              <span>Choose folder…</span>
            </Button>
          </Show>
          <Input
            label="Name (optional)"
            value={projectName()}
            placeholder={projectPath().trim() ? baseName(projectPath().trim()) : 'Project name'}
            onInput={(e) => setProjectName(e.currentTarget.value)}
          />
        </div>
      </Modal>

      {/* ── Add-worktree modal ─────────────────────────────────────── */}
      <Modal
        open={addWorktreeOpen()}
        title="Add worktree"
        onClose={() => setAddWorktreeOpen(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddWorktreeOpen(false)}>Cancel</Button>
            <Button
              onClick={handleAddWorktree}
              disabled={!worktreePath().trim() || !worktreeBranch().trim()}
            >
              Add
            </Button>
          </>
        }
      >
        <div class={styles.modalForm}>
          <Input
            label="Worktree path"
            value={worktreePath()}
            placeholder="/path/to/worktree"
            onInput={(e) => setWorktreePath(e.currentTarget.value)}
          />
          <Show when={isTauri()}>
            <Button variant="secondary" size="sm" onClick={() => void pickDirectory(setWorktreePath)}>
              <Icon name="folder-open" size={13} />
              <span>Choose folder…</span>
            </Button>
          </Show>
          <Input
            label="Branch"
            value={worktreeBranch()}
            placeholder="branch-name"
            onInput={(e) => setWorktreeBranch(e.currentTarget.value)}
          />
          <label class={styles.toggleRow}>
            <Toggle
              checked={worktreeCreateBranch()}
              onChange={setWorktreeCreateBranch}
            />
            <span>Create branch if it doesn't exist</span>
          </label>
        </div>
      </Modal>

      {/* ── Remove-worktree confirmation modal ─────────────────────── */}
      <Modal
        open={removeTarget() !== null}
        title="Remove worktree"
        onClose={() => setRemoveTarget(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleRemoveWorktree}>Remove</Button>
          </>
        }
      >
        <p>Remove worktree at <code>{removeTarget()?.path}</code>? This cannot be undone.</p>
      </Modal>
    </div>
  );
};
