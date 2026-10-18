// The ESLint boundary of src/server/entitlements (M08; plan §6.5): routes and components may read
// the plan matrix (plans.ts), never decide entitlements themselves (access.ts, quota.ts). A probe
// file in src/components shows that the rule fires; probes are git-ignored and removed again.

import { randomUUID } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIR = 'src/components';
const PROBE_PREFIX = '__boundary-probe-';

async function removeProbes(): Promise<void> {
  const stale = (await readdir(path.join(root, DIR))).filter((name) => name.startsWith(PROBE_PREFIX));
  await Promise.all(stale.map((name) => rm(path.join(root, DIR, name), { force: true })));
}

async function lintProbe(code: string): Promise<string[]> {
  const name = `${PROBE_PREFIX}${randomUUID().slice(0, 8)}.ts`;
  const file = path.join(root, DIR, name);
  await writeFile(file, code, 'utf8');
  try {
    const [result] = await new ESLint({ cwd: root }).lintFiles([`${DIR}/${name}`]);
    return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
  } finally {
    await rm(file, { force: true });
  }
}

beforeAll(removeProbes);
afterAll(removeProbes);

describe('module boundary of src/server/entitlements (ESLint)', () => {
  it('lets a component read the plan matrix', async () => {
    const rules = await lintProbe("import { PLANS } from '@/server/entitlements/plans';\nexport const probe = PLANS;\n");
    expect(rules).not.toContain('no-restricted-imports');
  }, 60_000);

  it('refuses requireEntitlement() and the quota lock in a component', async () => {
    const rules = await lintProbe(
      [
        "import { requireEntitlement } from '@/server/entitlements/access';",
        "import { withQuota } from '@/server/entitlements/quota';",
        "import { decide } from '../server/entitlements/effective';",
        'export const probe = [requireEntitlement, withQuota, decide];',
        '',
      ].join('\n'),
    );
    expect(rules.filter((r) => r === 'no-restricted-imports')).toHaveLength(3);
  }, 60_000);
});
