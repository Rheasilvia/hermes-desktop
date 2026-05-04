import type { Component } from 'solid-js';
import { SearchInput } from '@/components/SearchInput.js';
import styles from './ModelSearch.module.css';

export interface ModelSearchProps {
  value: string;
  onChange: (value: string) => void;
  resultCount: number;
  totalCount: number;
}

export const ModelSearch: Component<ModelSearchProps> = (props) => {
  const hasFilter = () => props.value.length > 0;

  return (
    <div class={styles.wrapper}>
      <SearchInput
        value={props.value}
        placeholder="Search models..."
        onChange={props.onChange}
      />
      {hasFilter() && (
        <span class={styles.count}>
          {props.resultCount} of {props.totalCount} models
        </span>
      )}
    </div>
  );
};
