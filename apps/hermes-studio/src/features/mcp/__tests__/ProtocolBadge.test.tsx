import { render, screen } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { ProtocolBadge } from '../ProtocolBadge.js';

describe('ProtocolBadge', () => {
  it('renders separate labels for streamable HTTP and SSE', () => {
    render(() => (
      <>
        <ProtocolBadge transport="streamable_http" />
        <ProtocolBadge transport="sse" />
      </>
    ));

    expect(screen.getByText('Streamable HTTP')).toBeTruthy();
    expect(screen.getByText('SSE')).toBeTruthy();
  });
});
