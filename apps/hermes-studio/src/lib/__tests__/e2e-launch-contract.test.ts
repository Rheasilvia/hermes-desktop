import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Playwright renderer launch contract', () => {
  it('starts only the browser renderer and never launches Electron', () => {
    const script = readFileSync(resolve(process.cwd(), 'scripts/e2e_with_sidecar.sh'), 'utf8');

    expect(script).toContain('npm run dev:renderer');
    expect(script).not.toMatch(/^\s*npm run dev\s*$/m);
  });
});
