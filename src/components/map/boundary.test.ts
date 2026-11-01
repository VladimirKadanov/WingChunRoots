// The ESLint boundary of the map library (milestone M11): only src/components/map imports MapLibre
// (its islands load with next/dynamic, so no page loads it with its first JavaScript), and the map
// module keeps the bans of every component (no database). Probe files show that the rules fire;
// probes are git-ignored and removed again.

import { randomUUID } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIRS = ['src/components', 'src/components/map'];
const PROBE_PREFIX = '__boundary-probe-';

async function removeProbes(): Promise<void> {
  for (const dir of DIRS) {
    const stale = (await readdir(path.join(root, dir))).filter((name) => name.startsWith(PROBE_PREFIX));
    await Promise.all(stale.map((name) => rm(path.join(root, dir, name), { force: true })));
  }
}

async function lintProbe(dir: string, code: string): Promise<string[]> {
  const name = `${PROBE_PREFIX}${randomUUID().slice(0, 8)}.ts`;
  const file = path.join(root, dir, name);
  await writeFile(file, code, 'utf8');
  try {
    const [result] = await new ESLint({ cwd: root }).lintFiles([`${dir}/${name}`]);
    return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
  } finally {
    await rm(file, { force: true });
  }
}

beforeAll(removeProbes);
afterAll(removeProbes);

const MAP_IMPORTS = ["import * as maplibre from 'maplibre-gl';", "import { Map } from '@vis.gl/react-maplibre';", 'export const probe = [maplibre, Map];', ''].join('\n');

describe('module boundary of the map library (ESLint)', () => {
  it('refuses MapLibre outside src/components/map', async () => {
    const rules = await lintProbe('src/components', MAP_IMPORTS);
    expect(rules.filter((r) => r === 'no-restricted-imports')).toHaveLength(2);
  }, 60_000);

  it('lets src/components/map import MapLibre, and still refuses the database there', async () => {
    expect(await lintProbe('src/components/map', MAP_IMPORTS)).not.toContain('no-restricted-imports');
    const rules = await lintProbe('src/components/map', "import { getDb } from '@/server/db';\nexport const probe = getDb;\n");
    expect(rules).toContain('no-restricted-imports');
  }, 60_000);
});
