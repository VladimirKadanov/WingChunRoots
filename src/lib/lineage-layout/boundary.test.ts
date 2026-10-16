import { randomUUID } from 'node:crypto';
import { readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
/** The module folder relative to the repository root, with `/` (ESLint globs need it, also on Windows). */
const MODULE_DIR = 'src/lib/lineage-layout';
/** Probe files; git-ignored, so a run killed before its cleanup leaves `git status` clean. */
const PROBE_PREFIX = '__boundary-probe-';
const created: string[] = [];

/** The folders that get probe files: the module and the rest of src/lib. */
const PROBE_DIRS = [MODULE_DIR, 'src/lib'];

async function removeProbes(): Promise<void> {
  for (const dir of PROBE_DIRS) {
    const stale = (await readdir(path.join(root, dir))).filter((name) => name.startsWith(PROBE_PREFIX));
    await Promise.all(stale.map((name) => rm(path.join(root, dir, name), { force: true })));
  }
}

/** Writes a temporary file into `dir` (src/lib/lineage-layout by default), lints it and returns the rule ids hit. */
async function lintTemporary(suffix: string, code: string, dir = MODULE_DIR): Promise<string[]> {
  const name = `${PROBE_PREFIX}${randomUUID().slice(0, 8)}${suffix}`;
  const file = path.join(root, dir, name);
  created.push(file);
  await writeFile(file, code, 'utf8');
  try {
    const [result] = await new ESLint({ cwd: root }).lintFiles([`${dir}/${name}`]);
    return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
  } finally {
    await rm(file, { force: true });
  }
}

// A probe left behind by a killed run would fail `pnpm lint`; remove it before and after.
beforeAll(removeProbes);
afterAll(async () => {
  await Promise.all(created.map((file) => rm(file, { force: true })));
  await removeProbes();
});

describe('module boundary of src/lib/lineage-layout (ESLint, plan §6.1)', () => {
  it('fails lint for a temporary file in the folder that imports react', async () => {
    const rules = await lintTemporary('.ts', "import { useState } from 'react';\nexport const probe = useState;\n");
    expect(rules).toContain('no-restricted-imports');
  }, 60_000);

  it('fails lint for next, src/server and the non-bundled elkjs entry points', async () => {
    const rules = await lintTemporary(
      '.ts',
      [
        "import { cookies } from 'next/headers';",
        "import { db } from '@/server/db';",
        "import ELK from 'elkjs/lib/elk-api';",
        'export const probe = [cookies, db, ELK];',
        '',
      ].join('\n'),
    );
    expect(rules.filter((r) => r === 'no-restricted-imports')).toHaveLength(3);
  }, 60_000);

  it('fails lint for DOM globals outside *.worker.ts', async () => {
    const rules = await lintTemporary(
      '.ts',
      'export const probe = [window.innerWidth, document.title, self, postMessage];\n',
    );
    expect(rules.filter((r) => r === 'no-restricted-globals')).toHaveLength(4);
  }, 60_000);

  it('fails lint for dynamic imports of react, next, src/server and elkjs entry points, and for DOM globals through globalThis', async () => {
    const rules = await lintTemporary(
      '.ts',
      [
        "export const react = () => import('react');",
        "export const headers = () => import('next/headers');",
        "export const db = () => import('@/server/db');",
        "export const elkApi = () => import('elkjs/lib/elk-api.js');",
        'export const title = globalThis.document.title;',
        'export const width = globalThis.window.innerWidth;',
        '',
      ].join('\n'),
    );
    expect(rules.filter((r) => r === 'no-restricted-syntax')).toHaveLength(6);
  }, 60_000);

  it('lets a *.worker.ts file use self and postMessage, but not import react', async () => {
    const globalsOnly = await lintTemporary(
      '.worker.ts',
      '/// <reference lib="webworker" />\ndeclare const self: DedicatedWorkerGlobalScope;\nself.postMessage(1);\nexport {};\n',
    );
    expect(globalsOnly).toEqual([]);
    const withReact = await lintTemporary(
      '.worker.ts',
      "import { useState } from 'react';\nexport const probe = useState;\n",
    );
    expect(withReact).toContain('no-restricted-imports');
    const dynamicReact = await lintTemporary('.worker.ts', "export const probe = () => import('react');\n");
    expect(dynamicReact).toContain('no-restricted-syntax');
  }, 60_000);

  it('fails lint for elkjs and the layout in the rest of src/lib, so no re-export carries them into a page', async () => {
    const rules = await lintTemporary(
      '.ts',
      [
        "export { layoutLineage } from '@/lib/lineage-layout/layout';",
        "import ELK from 'elkjs/lib/elk.bundled.js';",
        "export type { LineageGraph } from '@/lib/lineage-layout/types';",
        'export const probe = ELK;',
        '',
      ].join('\n'),
      'src/lib',
    );
    expect(rules.filter((r) => r === 'no-restricted-imports')).toHaveLength(2);
  }, 60_000);

  it('passes lint for layout.worker.ts and the rest of the module', async () => {
    const results = await new ESLint({ cwd: root }).lintFiles([`${MODULE_DIR}/*.ts`, `${MODULE_DIR}/testing/*.ts`]);
    const problems = results.flatMap((r) =>
      r.messages.map((m) => `${path.relative(root, r.filePath)}:${m.line} ${m.ruleId}: ${m.message}`),
    );
    expect(results.some((r) => r.filePath.endsWith('layout.worker.ts'))).toBe(true);
    expect(problems).toEqual([]);
  }, 120_000);
});
