import { render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HermesStudioBridge } from '@/shared/native-bridge.js';
import { installNativeHostMock } from '@/services/native-host.js';
import { MarkdownContent } from '../MarkdownContent.js';

let restoreHost: (() => void) | undefined;

afterEach(() => {
  restoreHost?.();
  restoreHost = undefined;
});

function click(anchor: HTMLAnchorElement): boolean {
  let preventedByComponent = false;
  document.addEventListener('click', (event) => {
    preventedByComponent = event.defaultPrevented;
    // Keep jsdom from scheduling a real navigation after we observe whether
    // MarkdownContent handled the event.
    event.preventDefault();
  }, { once: true });
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  anchor.dispatchEvent(event);
  return preventedByComponent;
}

describe('MarkdownContent native external links', () => {
  it('routes HTTP links through the frozen native host', () => {
    const openExternal = vi.fn(async () => undefined);
    restoreHost = installNativeHostMock({
      system: { openExternal },
    } as unknown as HermesStudioBridge);
    const view = render(() => (
      <MarkdownContent content="[Open docs](https://docs.example/path?q=1)" />
    ));
    const anchor = view.container.querySelector('a')!;

    const prevented = click(anchor);

    expect(prevented).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://docs.example/path?q=1');
  });

  it('preserves ordinary browser navigation when no native host exists', () => {
    restoreHost = installNativeHostMock(null);
    const view = render(() => <MarkdownContent content="[Open docs](https://docs.example/)" />);

    const prevented = click(view.container.querySelector('a')!);

    expect(prevented).toBe(false);
  });

  it('never sends relative or non-HTTP links to the native host', () => {
    const openExternal = vi.fn(async () => undefined);
    restoreHost = installNativeHostMock({
      system: { openExternal },
    } as unknown as HermesStudioBridge);
    const view = render(() => (
      <MarkdownContent content={'[Relative](/settings)\n\n[Email](mailto:user@example.com)'} />
    ));

    for (const anchor of Array.from(view.container.querySelectorAll('a'))) {
      expect(click(anchor)).toBe(false);
    }
    expect(openExternal).not.toHaveBeenCalled();
  });
});
