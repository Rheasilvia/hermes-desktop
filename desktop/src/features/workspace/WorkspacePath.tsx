import type { Component } from 'solid-js';
import styles from './WorkspacePath.module.css';

interface WorkspacePathProps {
  path: string;
}

function truncatePath(path: string, maxLen = 300): string {
  if (path.length <= 28) return path;
  const segments = path.split('/');
  if (segments.length <= 2) return path;
  const first = segments[0] || '';
  const last = segments[segments.length - 1] || '';
  const mid = '...';
  let result = `${first}/${mid}/${last}`;
  // Grow outwards until we hit max display length
  let left = 1;
  let right = segments.length - 2;
  while (result.length < 28 && left <= right) {
    if (left <= right) {
      result = segments.slice(0, left + 1).join('/') + `/${mid}/` + segments.slice(right).join('/');
      left++;
    }
    if (left <= right) {
      right--;
      result = segments.slice(0, left + 1).join('/') + `/${mid}/` + segments.slice(right + 1).join('/');
    }
  }
  return result;
}

export const WorkspacePath: Component<WorkspacePathProps> = (props) => {
  return (
    <span class={styles.path} title={props.path}>
      {truncatePath(props.path)}
    </span>
  );
};
