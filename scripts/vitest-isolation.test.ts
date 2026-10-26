// The unit tests share their worker's module graph (vitest.config.mts, `isolate: false`), except
// the files listed in ISOLATED there. A file that mocks modules, resets the module registry,
// stubs environment variables or globals, sets process.env, replaces a built-in such as fetch or
// Date.now, or uses fake timers could leak that into the next file of its worker, so it has to be
// in ISOLATED. This test finds such files in their text; scripts/vitest-shared-state.ts checks at
// run time what each shared file leaves behind.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

/** The shared objects a test may not write to: process, the global object and these built-ins. */
const SHARED = String.raw`(process|globalThis|global|Date|Math|console|JSON)`;
/** The name itself, not a property of something else (`options.global`). */
const BARE = String.raw`(?<![\w$.])`;

/**
 * What can change another file's view: module mocks and resets, env and global stubs, fake
 * timers, and a write to a property of process (process.env in any form: a key set or deleted,
 * the object replaced or merged into; process.argv), of globalThis or global (app singletons such
 * as __wcrAuth, fetch) or of Date, Math, console or JSON (Date.now, console.error), anywhere in a
 * line, and process listeners. vi.spyOn needs no entry: Vitest restores every spy after each file.
 * The patterns read codeOf(), so a string or a comment that spells such a write does not count.
 */
const SHARED_STATE = new RegExp(
  [
    String.raw`\bvi\.(mock|doMock|unmock|doUnmock|resetModules|stubEnv|stubGlobal|useFakeTimers|setSystemTime)\(`,
    String.raw`${BARE}${SHARED}${PROP}+${ASSIGN}`,
    // A cast: (globalThis as { __wcrAuth?: unknown }).__wcrAuth = undefined
    String.raw`\(\s*(globalThis|global)\s+as\b.*?\)${PROP}+${ASSIGN}`,
    String.raw`\bdelete\s+\(?\s*${SHARED}\b`,
    String.raw`(Object\.(assign|defineProperty|defineProperties)|Reflect\.(set|deleteProperty|defineProperty))\(\s*${SHARED}\b`,
    String.raw`process\.(on|once|addListener|prependListener|prependOnceListener|chdir)\(`,
  ].join('|'),
);

/** Tokens whose text is data, not code. */
const LITERALS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.JsxText,
]);

/**
 * A file's code as SHARED_STATE reads it: comments removed and the text inside strings, template
 * literals and regular expressions blanked (a fixture string that spells `globalThis.x = 1`
 * changes nothing). Every other character and every line break keeps its place.
 */
function codeOf(file: string, text: string): string {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, kind);
  const out = text.replace(/[^\n]/g, ' ').split('');
  const visit = (node: ts.Node): void => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const children = node.getChildren(source);
    if (children.length > 0) {
      for (const child of children) visit(child);
      return;
    }
    const start = node.getStart(source);
    const end = node.getEnd();
    if (start >= end) return;
    if (LITERALS.has(node.kind)) {
      out[start] = text[start]!;
      out[end - 1] = text[end - 1]!;
      return;
    }
    for (let i = start; i < end; i++) out[i] = text[i]!;
  };
  visit(source);
  return out.join('');
}

function changesSharedState(file: string, text: string): boolean {
  return SHARED_STATE.test(codeOf(file, text));
}

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
      (file) => file !== SELF && !ISOLATED.includes(file) && !TIMED.includes(file) && changesSharedState(file, readFileSync(path.join(root, file), 'utf8')),
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
      '(globalThis as { f?: () => void }).f = fake',
      'delete (globalThis as { __wcrAuth?: unknown }).__wcrAuth',
      "process.on('unhandledRejection', handler)",
      'beforeAll(() => { globalThis.fetch = fake; });',
      'if (x) globalThis.foo = 1;',
      'global.fetch = fake',
      'global.structuredClone = ((v: unknown) => v) as typeof structuredClone;',
      "globalThis['fetch'] ??= fake",
      'delete global.fetch',
      'Date.now = () => 0',
      'Math.random = () => 0.5',
      'console.error = () => undefined',
      'JSON.parse = fake',
      "Object.defineProperty(Date, 'now', { value: () => 0 })",
      "Object.assign(console, { error: () => undefined })",
      "Reflect.set(globalThis, 'fetch', fake)",
      "process.argv = ['node', 'x']",
      'process.exitCode = 1',
    ]) {
      expect(changesSharedState('sample.ts', line), line).toBe(true);
    }
    for (const line of [
      'process.env.NODE_ENV === "x"',
      'process.env.A !== undefined',
      'vi.fn()',
      'const env = process.env.A',
      'const env = { ...process.env, A: "b" }',
      'const store = globalThis as unknown as { x?: number }',
      '`globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};`',
      'const script = "globalThis.fetch = fake; Date.now = () => 0";',
      '// globalThis.fetch = fake',
      '/* Date.now = () => 0 */',
      "vi.spyOn(console, 'error')",
      'const now = Date.now()',
      'if (globalThis.fetch === fake) return;',
      'const parsed = JSON.parse(text)',
      "console.error('a = b')",
      'options.global.fetch = fake',
      'const x = { global: 1 }; x.global = 2',
      'const replace = /globalThis\\.x = 1/;',
    ]) {
      expect(changesSharedState('sample.ts', line), line).toBe(false);
    }
  });
});
