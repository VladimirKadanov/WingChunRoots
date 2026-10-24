// The E2E build check (e2e/build-check.ts): `pnpm e2e` after a plain `pnpm build` must say
// "run pnpm build:e2e first" instead of failing at the web server (review round 2, recheck-1).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { e2eBuildProblem } from './build-check';

const root = mkdtempSync(join(tmpdir(), 'wcr-build-check-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function build(name: string, contents: string | null): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  if (contents !== null) writeFileSync(join(dir, 'required-server-files.json'), contents);
  return dir;
}

const serverFiles = (env: Record<string, string>) => JSON.stringify({ version: 1, config: { env }, files: [] });

describe('e2eBuildProblem', () => {
  it('accepts the E2E build (WCR_E2E_BUILD=1 inlined by next.config.ts)', () => {
    expect(e2eBuildProblem(build('e2e', serverFiles({ WCR_E2E_BUILD: '1' })))).toBeNull();
  });

  it('refuses a deployable build and names pnpm build:e2e', () => {
    const problem = e2eBuildProblem(build('deployable', serverFiles({ WCR_E2E_BUILD: '' })));
    expect(problem).toContain('deployable build');
    expect(problem).toContain('pnpm build:e2e');
  });

  it('refuses a missing build, a build without the flag and an unreadable record', () => {
    for (const dir of [join(root, 'nothing-here'), build('no-env', JSON.stringify({ config: {} })), build('broken', '{')]) {
      expect(e2eBuildProblem(dir), dir).toContain('pnpm build:e2e');
    }
  });
});
