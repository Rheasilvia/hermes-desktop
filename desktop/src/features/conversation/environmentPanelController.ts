import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js';
import { getGateway } from '@/stores/context.js';
import { gitViewStore } from '@/stores/git-view.js';
import { sidePanelStore } from '@/stores/side-panel.js';

interface EnvironmentPanelControllerProps {
  sessionId: string | null;
  workspacePath: string | null;
}

export function getEnvironmentWorkspaceName(path: string | null): string {
  if (!path) return 'No workspace';
  const normalized = path.replace(/[\\/]+$/, '').replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() ?? path;
}

export function createEnvironmentPanelController(props: EnvironmentPanelControllerProps) {
  const [currentBranch, setCurrentBranch] = createSignal<string | null>(null);
  const [branches, setBranches] = createSignal<string[]>([]);
  const [branchMenuOpen, setBranchMenuOpen] = createSignal(false);
  const [branchLoading, setBranchLoading] = createSignal(false);
  const [branchError, setBranchError] = createSignal<string | null>(null);
  let branchRoot: HTMLDivElement | undefined;

  const workspaceName = createMemo(() => getEnvironmentWorkspaceName(props.workspacePath));
  const diffSummary = createMemo(() => gitViewStore.diffData()?.summary ?? null);
  const hasWorkspace = createMemo(() => Boolean(props.sessionId && props.workspacePath));
  const branchDisabled = createMemo(() => !hasWorkspace() || branches().length === 0);
  const branchLabel = createMemo(() => {
    if (branchLoading()) return 'Loading branch';
    return currentBranch() ?? 'No branch';
  });

  const loadBranches = async (sessionId: string) => {
    setBranchLoading(true);
    setBranchError(null);
    try {
      const info = await getGateway()?.git.branches(sessionId);
      if (!info) throw new Error('Gateway is not initialized');
      setCurrentBranch(info.current || null);
      setBranches(info.branches);
    } catch (error) {
      setCurrentBranch(null);
      setBranches([]);
      setBranchError(error instanceof Error ? error.message : 'Could not load branches');
    } finally {
      setBranchLoading(false);
    }
  };

  createEffect(() => {
    const sessionId = props.sessionId;
    const workspacePath = props.workspacePath;
    setBranchMenuOpen(false);
    if (!sessionId || !workspacePath) {
      setCurrentBranch(null);
      setBranches([]);
      setBranchError(null);
      return;
    }
    void gitViewStore.fetchDiff();
    void loadBranches(sessionId);
  });

  createEffect(() => {
    if (!branchMenuOpen()) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && branchRoot?.contains(target)) return;
      setBranchMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setBranchMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    });
  });

  const openReview = () => sidePanelStore.openTab('review');
  const openFiles = () => sidePanelStore.openTab('files');
  const requestAddTool = () => {
    sidePanelStore.open();
    sidePanelStore.requestToolMenuOpen();
  };

  const toggleBranchMenu = () => {
    if (branchDisabled()) return;
    setBranchMenuOpen((open) => !open);
  };

  const selectBranch = async (branch: string) => {
    const sessionId = props.sessionId;
    if (!sessionId) return;
    setBranchMenuOpen(false);
    setBranchError(null);
    try {
      const gateway = getGateway();
      if (!gateway) throw new Error('Gateway is not initialized');
      await gateway.git.checkout(sessionId, branch);
      setCurrentBranch(branch);
      await loadBranches(sessionId);
      await gitViewStore.fetchDiff();
    } catch (error) {
      setBranchError(error instanceof Error ? error.message : 'Could not switch branches');
    }
  };

  return {
    branchDisabled,
    branchError,
    branchLabel,
    branchMenuOpen,
    branches,
    currentBranch,
    diffSummary,
    openFiles,
    openReview,
    requestAddTool,
    selectBranch,
    setBranchRoot: (el: HTMLDivElement) => {
      branchRoot = el;
    },
    toggleBranchMenu,
    workspaceName,
  };
}
