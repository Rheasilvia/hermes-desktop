import { render, screen, fireEvent } from '@solidjs/testing-library';
import { describe, test, expect } from 'vitest';
import { ReasoningPanel } from '../ReasoningPanel.js';

describe('ReasoningPanel', () => {
  test('renders in-progress state when isStreaming is true', () => {
    render(() => (
      <ReasoningPanel
        content="Analyzing code..."
        isStreaming={true}
        tokenCount={null}
      />
    ));

    expect(screen.getByText('Thinking...')).toBeDefined();
    expect(screen.getByText('Analyzing code...')).toBeDefined();
  });

  test('renders collapsed state when isStreaming is false', () => {
    render(() => (
      <ReasoningPanel
        content="Reasoning content here"
        isStreaming={false}
        tokenCount={180}
      />
    ));

    expect(screen.getByText('Thought for 4s')).toBeDefined();
    expect(screen.getByText('Show reasoning')).toBeDefined();
  });

  test('renders collapsed state without duration when tokenCount is null', () => {
    render(() => (
      <ReasoningPanel
        content="Reasoning content here"
        isStreaming={false}
        tokenCount={null}
      />
    ));

    expect(screen.getByText('Thought')).toBeDefined();
  });

  test('expands to show full reasoning on click', () => {
    render(() => (
      <ReasoningPanel
        content="Full reasoning text"
        isStreaming={false}
        tokenCount={180}
      />
    ));

    fireEvent.click(screen.getByText('Show reasoning'));

    expect(screen.getByText('Reasoning · 4s')).toBeDefined();
    expect(screen.getByText('Hide')).toBeDefined();
    expect(screen.getByText('Full reasoning text')).toBeDefined();
  });

  test('collapses back on hide click', () => {
    render(() => (
      <ReasoningPanel
        content="Full reasoning text"
        isStreaming={false}
        tokenCount={180}
      />
    ));

    fireEvent.click(screen.getByText('Show reasoning'));
    expect(screen.getByText('Hide')).toBeDefined();

    fireEvent.click(screen.getByText('Hide'));
    expect(screen.getByText('Show reasoning')).toBeDefined();
  });

  test('displays reasoning content in expanded state', () => {
    const content = 'Line one\nLine two\nLine three';
    render(() => (
      <ReasoningPanel
        content={content}
        isStreaming={false}
        tokenCount={100}
      />
    ));

    fireEvent.click(screen.getByText('Show reasoning'));
    expect(screen.getByText((_, el) => el?.textContent === content)).toBeDefined();
  });
});
