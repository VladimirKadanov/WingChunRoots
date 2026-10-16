import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { afterAll, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const created: string[] = [];

/** Writes a temporary file into src/lib/lineage-layout, lints it and returns the rule ids hit. */
async function lintTemporary(suffix: string, code: string): Promise<string[]> {
  const file = path.join(here, `__boundary-probe-${randomUUID().slice(0, 8)}${suffix}`);
  created.push(file);
  await writeFile(file, code, 'utf8');
  try {
    const [result] = await new ESLint({ cwd: root }).lintFiles([file]);
    return (result?.messages ?? []).map((m) => m.ruleId ?? `fatal: ${m.message}`);
  } finally {
    await rm(file, { force: true });
  }
}

afterAll(async () => {
  await Promise.all(created.map((file) => rm(file, { force: true })));
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
  }, 60_000);

  it('passes lint for layout.worker.ts and the rest of the module', async () => {
    const results = await new ESLint({ cwd: root }).lintFiles([path.join(here, '*.ts'), path.join(here, 'testing/*.ts')]);
    const problems = results.flatMap((r) =>
      r.messages.map((m) => `${path.relative(root, r.filePath)}:${m.line} ${m.ruleId}: ${m.message}`),
    );
    expect(results.some((r) => r.filePath.endsWith('layout.worker.ts'))).toBe(true);
    expect(problems).toEqual([]);
  }, 120_000);
});
