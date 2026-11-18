// The control panel's Bulgarian is complete (docs/adr/0043-admin-bulgarian.md): every literal that a
// file under /admin passes to t('…') or t.n(count, '…', '…') has a Bulgarian entry, client files in
// the client parts (the only part the browser gets), entries keep their {placeholders}, and an
// entry in two parts reads the same in both.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

import { BG_ADMIN, BG_ADMIN_CLIENT, BG_CLIENT_PARTS, BG_SERVER_PARTS } from './index';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const SCANNED = ['src/app/admin', 'src/components/admin'];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'i18n' ? [] : files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const unquote = (body: string) => body.replace(/\\(['"\\])/g, '$1');

/** The literals passed to t(…) and t.n(…, …, …) in `source`. */
function literals(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\bt\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g)) found.push(unquote(m[2]!));
  for (const m of source.matchAll(/\bt\(\s*`([^`$]*)`/g)) found.push(m[1]!);
  const n = /\bt\.n\([^'"`]*?(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\\n])*)\3/g;
  for (const m of source.matchAll(n)) found.push(unquote(m[2]!), unquote(m[4]!));
  const x = /\bt\.x\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1\s*,\s*(['"])((?:\\.|(?!\3)[^\\\n])*)\3/g;
  for (const m of source.matchAll(x)) found.push(`${unquote(m[2]!)}|${unquote(m[4]!)}`);
  return found;
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('the control panel in Bulgarian', () => {
  const scanned = SCANNED.flatMap((dir) => files(join(ROOT, dir)));

  it('finds the t() calls (the scan works)', () => {
    expect(literals(`t('A b') t("C") t(\`D\`) t.n(count, '{n} case', '{n} cases') t.x('verb', 'Open')`)).toEqual(['A b', 'C', 'D', '{n} case', '{n} cases', 'verb|Open']);
  });

  it('has Bulgarian for every literal passed to t() under /admin', () => {
    const missing: string[] = [];
    for (const path of scanned) {
      const source = readFileSync(path, 'utf8');
      const client = /^\s*['"]use client['"]/m.test(source.slice(0, 2000));
      const dict = client ? BG_ADMIN_CLIENT : BG_ADMIN;
      for (const text of literals(source)) {
        if (!(text in dict)) missing.push(`${relative(ROOT, path)}${client ? ' (client)' : ''}: ${JSON.stringify(text)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps every {placeholder} of an entry', () => {
    const wrong = Object.entries(BG_ADMIN)
      .filter(([en, bg]) => placeholders(en).join() !== placeholders(bg).join())
      .map(([en, bg]) => `${en} → ${bg}`);
    expect(wrong).toEqual([]);
  });

  it('gives an entry the same Bulgarian in every part that has it', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const part of [...Object.values(BG_CLIENT_PARTS), ...Object.values(BG_SERVER_PARTS)]) {
      for (const [en, bg] of Object.entries(part)) {
        const before = seen.get(en);
        if (before !== undefined && before !== bg) clashes.push(`${en}: "${before}" / "${bg}"`);
        seen.set(en, bg);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('has no empty entries', () => {
    expect(Object.entries(BG_ADMIN).filter(([, bg]) => bg.trim() === '')).toEqual([]);
  });
});
