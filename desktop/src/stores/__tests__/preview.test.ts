import { beforeEach, describe, expect, it } from 'vitest';
import { previewStore } from '../preview.js';

describe('previewStore', () => {
  beforeEach(() => {
    window.localStorage.clear();
    previewStore.clearAll();
  });

  it('keeps one independent active plan preview per session', () => {
    previewStore.registerPlan('sess_1', {
      blockId: 'plan-block-1',
      label: 'Plan A',
      messageId: 42,
    });
    previewStore.registerPlan('sess_2', {
      blockId: 'plan-block-2',
      label: 'Plan B',
    });

    expect(previewStore.get('sess_1')?.normalized).toMatchObject({
      kind: 'plan',
      label: 'Plan A',
      sessionId: 'sess_1',
      blockId: 'plan-block-1',
      messageId: '42',
    });
    expect(previewStore.get('sess_2')?.normalized).toMatchObject({
      kind: 'plan',
      label: 'Plan B',
      sessionId: 'sess_2',
      blockId: 'plan-block-2',
    });
  });

  it('registers plan previews as references without persisted markdown content', () => {
    previewStore.registerPlan('sess_1', {
      blockId: 'plan-block-1',
      label: 'Implementation Plan',
      messageId: 42,
    });

    const record = previewStore.get('sess_1');
    expect(record?.normalized).toEqual({
      kind: 'plan',
      label: 'Implementation Plan',
      sessionId: 'sess_1',
      blockId: 'plan-block-1',
      messageId: '42',
    });
    expect(window.localStorage.getItem('hermes.tauri.sessionPreviews.v1')).not.toContain('Full plan body');
  });

  it('dismisses only the requested session plan preview', () => {
    previewStore.registerPlan('sess_1', { blockId: 'plan-block-1' });
    previewStore.registerPlan('sess_2', { blockId: 'plan-block-2' });

    previewStore.dismiss('sess_1');

    expect(previewStore.get('sess_1')).toBeNull();
    expect(previewStore.get('sess_2')).not.toBeNull();
  });

  it('ignores invalid plan preview references', () => {
    previewStore.registerPlan('sess_1', {
      blockId: '   ',
      label: 'Implementation Plan',
    });

    expect(previewStore.get('sess_1')).toBeNull();
  });

});
