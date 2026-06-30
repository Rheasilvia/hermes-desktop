import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { workspaceTreeStore } from '@/stores/workspace-tree.js';
import type { WorkspaceFileResult, WorkspaceTreeNode } from '@/types/index.js';
import { WorkspaceTreeView } from '../WorkspaceTreeView.js';
import { WorkspaceFilePreviewPane } from '../WorkspaceFilePreviewPane.js';

const mocks = vi.hoisted(() => ({
  gateway: {
    workspace: {
      children: vi.fn(),
      readFile: vi.fn(),
      writeFile: vi.fn(),
      reveal: vi.fn(),
    },
  },
}));

vi.mock('@/stores/context.js', () => ({
  getGateway: () => mocks.gateway,
}));

describe('WorkspaceTreeView', () => {
  beforeEach(async () => {
    await workspaceTreeStore.setWorkspace(null, null);
    mocks.gateway.workspace.children.mockReset().mockImplementation(async (_sessionId: string, path: string) => ({
      root: path,
      path,
      children: [
        { path: `${path}/src`, name: 'src', kind: 'directory', ignored: false, loaded: false },
        { path: `${path}/README.md`, name: 'README.md', kind: 'file', ignored: false, loaded: true },
      ],
      truncated: false,
      total_read: 2,
    }));
    mocks.gateway.workspace.readFile.mockReset().mockResolvedValue({
      content: '# Hello',
      truncated: false,
      binary: false,
      size: 7,
      mtime: 10,
    });
    mocks.gateway.workspace.writeFile.mockReset().mockResolvedValue({
      content: '# Updated',
      truncated: false,
      binary: false,
      size: 9,
      mtime: 11,
    });
    mocks.gateway.workspace.reveal.mockReset().mockResolvedValue(undefined);
  });

  it('renders only the active workspace file browser without project or worktree switchers', async () => {
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);

    expect(await screen.findByRole('tree', { name: 'Workspace files' })).toBeTruthy();
    expect(screen.queryByLabelText('Active project')).toBeNull();
    expect(screen.queryByLabelText('Project worktrees')).toBeNull();
  });

  it('opens a file in the embedded preview with single-click and marks the previewed row', async () => {
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);

    await fireEvent.click(await screen.findByRole('treeitem', { name: /README.md/ }));

    await waitFor(() => expect(mocks.gateway.workspace.readFile).toHaveBeenCalledWith('session-one', '/repo/README.md'));
    expect(await screen.findByText('Hello')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByRole('treeitem', { name: /README.md/ }).getAttribute('aria-current')).toBe('true');
    });
  });

  it('opens the focused file with Enter and Cmd/Ctrl+O without opening directories', async () => {
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);

    const tree = await screen.findByRole('tree', { name: 'Workspace files' });
    tree.focus();
    await fireEvent.keyDown(tree, { key: 'ArrowDown' });
    await fireEvent.keyDown(tree, { key: 'ArrowDown' });
    await fireEvent.keyDown(tree, { key: 'Enter' });

    await waitFor(() => expect(mocks.gateway.workspace.readFile).toHaveBeenCalledWith('session-one', '/repo/README.md'));
    expect(await screen.findByText('Hello')).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Close file preview' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'No file preview selected' })).toBeTruthy());
    mocks.gateway.workspace.readFile.mockClear();
    await fireEvent.keyDown(tree, { key: 'o', metaKey: true });
    await waitFor(() => expect(mocks.gateway.workspace.readFile).toHaveBeenCalledWith('session-one', '/repo/README.md'));
  });

  it('opens preview from the context menu', async () => {
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath="/repo" />);

    await fireEvent.contextMenu(await screen.findByRole('treeitem', { name: /README.md/ }));
    await fireEvent.click(screen.getByRole('button', { name: /Preview File/ }));

    await waitFor(() => expect(mocks.gateway.workspace.readFile).toHaveBeenCalledWith('session-one', '/repo/README.md'));
  });

  it('clears the preview when switching workspaces', async () => {
    await workspaceTreeStore.setWorkspace('session-one', '/repo');

    const [workspacePath, setWorkspacePath] = createSignal('/repo');
    render(() => <WorkspaceTreeView sessionId="session-one" workspacePath={workspacePath()} />);

    await fireEvent.click(await screen.findByRole('treeitem', { name: /README.md/ }));
    expect(await screen.findByText('Hello')).toBeTruthy();

    await workspaceTreeStore.setWorkspace('session-one', '/repo-wt');
    setWorkspacePath('/repo-wt');

    await waitFor(() => expect(screen.getByRole('status', { name: 'No file preview selected' })).toBeTruthy());
  });
});

describe('WorkspaceFilePreviewPane', () => {
  beforeEach(() => {
    mocks.gateway.workspace.readFile.mockReset().mockResolvedValue({
      content: 'before',
      truncated: false,
      binary: false,
      size: 6,
      mtime: 42,
    });
    mocks.gateway.workspace.writeFile.mockReset().mockResolvedValue({
      content: 'after',
      truncated: false,
      binary: false,
      size: 5,
      mtime: 43,
    });
  });

  it('saves editable files with metadata guards and keeps refreshed content', async () => {
    render(() => (
      <WorkspaceFilePreviewPane
        node={{ path: '/repo/a.txt', name: 'a.txt', kind: 'file', ignored: false, loaded: true }}
        sessionId="session-one"
        workspaceRoot="/repo"
        onClose={() => undefined}
      />
    ));

    expect(await screen.findByText('before')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const editor = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.input(editor, { target: { value: 'after' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.gateway.workspace.writeFile).toHaveBeenCalledWith('session-one', {
      path: '/repo/a.txt',
      content: 'after',
      expectedMtime: 42,
      expectedSize: 6,
    }));
    expect(await screen.findByText('after')).toBeTruthy();
  });

  it('hides stale edit controls while a different file is loading', async () => {
    let resolveSecond!: (result: WorkspaceFileResult) => void;
    mocks.gateway.workspace.readFile
      .mockResolvedValueOnce({
        content: 'first',
        truncated: false,
        binary: false,
        size: 5,
        mtime: 1,
      })
      .mockImplementationOnce(() => new Promise<WorkspaceFileResult>((resolve) => {
        resolveSecond = resolve;
      }));

    const firstNode: WorkspaceTreeNode = {
      path: '/repo/a.txt',
      name: 'a.txt',
      kind: 'file',
      ignored: false,
      loaded: true,
    };
    const secondNode: WorkspaceTreeNode = {
      path: '/repo/b.txt',
      name: 'b.txt',
      kind: 'file',
      ignored: false,
      loaded: true,
    };
    let setNode!: (node: WorkspaceTreeNode) => void;

    const Harness = () => {
      const [node, updateNode] = createSignal(firstNode);
      setNode = updateNode;
      return (
        <WorkspaceFilePreviewPane
          node={node()}
          sessionId="session-one"
          workspaceRoot="/repo"
          onClose={() => undefined}
        />
      );
    };

    render(() => <Harness />);

    expect(await screen.findByText('first')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();

    setNode(secondNode);
    await waitFor(() => expect(mocks.gateway.workspace.readFile).toHaveBeenCalledWith('session-one', '/repo/b.txt'));
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    resolveSecond({
      content: 'second',
      truncated: false,
      binary: false,
      size: 6,
      mtime: 2,
    });

    expect(await screen.findByText('second')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });
});
