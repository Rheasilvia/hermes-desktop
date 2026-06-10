export type WorkspaceTreeNodeKind = 'file' | 'directory';

export interface WorkspaceTreeNode {
  path: string;
  name: string;
  kind: WorkspaceTreeNodeKind;
  ignored: boolean;
  loaded: boolean;
}

export interface WorkspaceChildrenResult {
  root: string;
  path: string;
  children: WorkspaceTreeNode[];
  truncated: boolean;
  total_read: number;
}

export interface WorkspaceFileResult {
  content: string | null;
  truncated: boolean;
  binary: boolean;
  size: number;
}

export interface WorkspaceTreeRow {
  node: WorkspaceTreeNode;
  depth: number;
}
