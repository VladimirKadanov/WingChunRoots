// `pnpm tokens:build`: writes src/design/generated/tokens.css and tokens.json from
// src/design/tokens.ts. `pnpm tokens:build --check` writes nothing and exits 1 when the
// committed files are out of date (scripts/verify.d/M00b.sh, CI).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { GENERATED_CSS_PATH, GENERATED_JSON_PATH, buildCss, buildJson } from '../src/design/build';

const root = resolve(import.meta.dirname, '..');
const check = process.argv.includes('--check');
const outputs: [string, string][] = [
  [GENERATED_CSS_PATH, buildCss()],
  [GENERATED_JSON_PATH, buildJson()],
];

let stale = 0;
for (const [path, content] of outputs) {
  const file = resolve(root, path);
  let current: string | null = null;
  try {
    current = readFileSync(file, 'utf8');
  } catch {
    current = null;
  }
  if (current === content) {
    console.log(`${path}: up to date`);
    continue;
  }
  if (check) {
    console.error(`${path}: out of date; run pnpm tokens:build`);
    stale += 1;
    continue;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
  console.log(`${path}: written`);
}
if (stale > 0) process.exit(1);
