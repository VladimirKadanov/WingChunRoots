// The unit tests share their worker's module graph (vitest.config.mts, `isolate: false`), except
// the files listed in ISOLATED there. A file that mocks modules, resets the module registry,
// stubs environment variables or globals, sets process.env or uses fake timers could leak that
// into the next file of its worker, so it has to be in ISOLATED. This test finds such files.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = readFileSync(path.join(root, 'vitest.config.mts'), 'utf8');

/** The file list of a `export const NAME = [...]` in vitest.config.mts. */
function listOf(name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([^\\]]*)\\]`).exec(config);
  if (!match) throw new Error(`vitest.config.mts has no ${name} list`);
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

const ISOLATED = listOf('ISOLATED');
const TIMED = listOf('TIMED');
/** This file names the APIs in its own samples. */
const SELF = 'scripts/vitest-isolation.test.ts';

/** An assignment operator (=, ??=, ||=, &&=, +=), not a comparison or an arrow. */
const ASSIGN = String.raw`\s*(\?\?|\|\||&&|\+)?=(?![=>])`;
/** A property access: `.name` or `[key]`. */
const PROP = String.raw`(\.\w+|\[[^\]]+\])`;

/**
 * What can change another file's view: module mocks and resets, env and global stubs, fake
 * timers, process.env written in any form (a key set or deleted, the object replaced or merged
 * into), properties of globalThis set or deleted (app singletons such as __wcrAuth), and process
 * listeners. vi.spyOn needs no entry: Vitest restores every spy after each file.
 */
const SHARED_STATE = new RegExp(
  [
    String.raw`\bvi\.(mock|doMock|unmock|doUnmock|resetModules|stubEnv|stubGlobal|useFakeTimers|setSystemTime)\(`,
    String.raw`process\.env${PROP}?${ASSIGN}`,
    String.raw`delete process\.env\b`,
    String.raw`(Object\.(assign|defineProperty|defineProperties)|Reflect\.(set|deleteProperty|defineProperty))\(\s*(process|globalThis)\b`,
    // A statement that starts with globalThis (not one inside a string), or a cast of it.
    String.raw`^\s*globalThis${PROP}+${ASSIGN}`,
    String.raw`\(\s*globalThis as [^)]*\)${PROP}+${ASSIGN}`,
    String.raw`delete \(?\s*globalThis\b`,
    String.raw`process\.(on|once|addListener|prependListener|prependOnceListener|chdir)\(`,
  ].join('|'),
  'm',
);

/** The unit test files (the `unit` and `unit-isolated` projects): *.test.ts(x) under src, e2e and scripts, no integration tests. */
function unitTestFiles(): string[] {
  const files: string[] = [];
  for (const dir of ['src', 'e2e', 'scripts']) {
    for (const entry of readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })) {
      const file = `${dir}/${entry.split(path.sep).join('/')}`;
      if (dir !== 'src' && file.includes('/node_modules/')) continue;
      if (!/\.test\.tsx?$/.test(file) || file.endsWith('.int.test.ts')) continue;
      if (dir !== 'src' && !file.endsWith('.test.ts')) continue;
      files.push(file);
    }
  }
  return files.sort();
}

describe('the unit tests that share a module graph (vitest.config.mts)', () => {
  it('keeps every file that changes shared state in ISOLATED', () => {
    const leaking = unitTestFiles().filter(
      (file) => file !== SELF && !ISOLATED.includes(file) && !TIMED.includes(file) && SHARED_STATE.test(readFileSync(path.join(root, file), 'utf8')),
    );
    expect(leaking, 'add these files to ISOLATED in vitest.config.mts').toEqual([]);
  });

  it('checks at run time what each shared file leaves behind (scripts/vitest-shared-state.ts)', () => {
    expect(config).toContain("setupFiles: ['./scripts/vitest-shared-state.ts']");
  });

  it('lists only files that exist', () => {
    const files = unitTestFiles();
    expect(ISOLATED.filter((file) => !files.includes(file))).toEqual([]);
  });

  it('finds the APIs it looks for', () => {
    for (const line of [
      "vi.mock('x')",
      'vi.stubEnv("A", "b")',
      'process.env.NODE_ENV = "x"',
      "process.env['A'] = 'b'",
      'delete process.env.A',
      'vi.useFakeTimers()',
      "process.env[name] ||= 'b'",
      "process.env.A ??= 'b'",
      'process.env = { ...saved }',
      "Object.assign(process.env, { A: 'b' })",
      "Reflect.deleteProperty(process.env, 'A')",
      'globalThis.fetch = fake',
      '  (globalThis as { __wcrAuth?: unknown }).__wcrAuth = undefined',
      'delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth',
      "process.on('unhandledRejection', handler)",
    ]) {
      expect(SHARED_STATE.test(line), line).toBe(true);
    }
    for (const line of [
      'process.env.NODE_ENV === "x"',
      'process.env.A !== undefined',
      'vi.fn()',
      'const env = process.env.A',
      'const env = { ...process.env, A: "b" }',
      'const store = globalThis as unknown as { x?: number }',
      '`globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};`',
      "vi.spyOn(console, 'error')",
    ]) {
      expect(SHARED_STATE.test(line), line).toBe(false);
    }
  });
});
