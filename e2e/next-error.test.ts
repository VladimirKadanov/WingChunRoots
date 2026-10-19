// Next.js's own pages as the installed Next.js writes them (M08 polish 2, note 1). The check of
// e2e/helpers/next-error.ts must match the heading of its error page, and no test may spell one of
// its built-in texts with a straight apostrophe or quote where Next.js writes a typographic one: an
// assertion that such a text is absent never matches the page, so it can never fail
// (e2e/m08-failures.exclusive.spec.ts had one).

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NEXT_ERROR_TITLE } from './helpers/next-error';

const ROOT = join(import.meta.dirname, '..');

/** Next.js's built-in pages: the error page (global-error.js), the static 500 page (app-error.js), not found and the like. */
const BUILTIN_DIRS = ['builtin', 'http-access-fallback'].map((dir) => join(ROOT, 'node_modules', 'next', 'dist', 'esm', 'client', 'components', dir));

/** The texts of one built-in page: the string children of its JSX. */
function textsOf(file: string): string[] {
  return [...readFileSync(file, 'utf8').matchAll(/children: "([^"\\]+)"/g)].map((match) => match[1]!);
}

/** Every text of Next.js's built-in pages, once. */
function builtinTexts(): string[] {
  const files = BUILTIN_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((name) => name.endsWith('.js'))
      .map((name) => join(dir, name)),
  );
  return [...new Set(files.flatMap(textsOf))];
}

const TYPOGRAPHIC = /[‘’“”]/;

/** `text` with straight apostrophes and quotes. */
function straight(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

/** Each typographic built-in text that `source` spells with straight apostrophes or quotes. */
function straightSpellings(source: string, texts: string[]): string[] {
  return texts.filter((text) => TYPOGRAPHIC.test(text)).filter((text) => source.includes(straight(text)));
}

/** Where tests are written: the E2E specs and helpers, the unit and integration tests, the milestone checks. */
function testFiles(): string[] {
  // Files only: e2e/__screenshots__/visual.spec.ts is a folder of baselines.
  const under = (dir: string, keep: (name: string) => boolean) =>
    readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(join(ROOT, dir), join(entry.parentPath, entry.name)).split(sep).join('/'))
      .filter(keep)
      .map((name) => `${dir}/${name}`);
  return [
    ...under('e2e', (name) => name.endsWith('.ts')),
    ...under('src', (name) => /\.test\.tsx?$/.test(name)),
    ...under('scripts', (name) => /\.test\.ts$/.test(name) || /^verify\.d\/.+\.sh$/.test(name)),
  ].sort();
}

describe("Next.js's error page", () => {
  it('has the heading NEXT_ERROR_TITLE matches, with JavaScript (global-error.js) and as the static 500 page (app-error.js)', () => {
    for (const page of ['global-error.js', 'app-error.js']) {
      const texts = textsOf(join(BUILTIN_DIRS[0]!, page));
      const heading = texts.find((text) => NEXT_ERROR_TITLE.test(text));
      expect(heading, `the heading of ${page} changed: update NEXT_ERROR_TITLE (e2e/helpers/next-error.ts)`).toBeDefined();
      // Either apostrophe: the one Next.js writes now and the straight one.
      expect(straight(heading!)).toMatch(NEXT_ERROR_TITLE);
    }
  });
});

describe('the tests', () => {
  it("never spell a text of Next.js's built-in pages with a straight apostrophe or quote", () => {
    const texts = builtinTexts();
    const heading = 'This page couldn’t load';
    // The check can fail: the heading is a typographic text, and the line the polish confirmation found is caught.
    expect(texts).toContain(heading);
    const oldLine = 'await expect(p.getByText("This page couldn' + "'" + 't load")).toHaveCount(0);';
    expect(straightSpellings(oldLine, texts)).toEqual([heading]);
    expect(straightSpellings(`getByText(${JSON.stringify(heading)})`, texts)).toEqual([]);

    const files = testFiles();
    expect(files).toEqual(expect.arrayContaining(['e2e/m08-failures.exclusive.spec.ts', 'e2e/helpers/next-error.ts', 'src/lib/copy/copy.no-fomo.test.ts', 'scripts/verify.d/M08.sh']));
    const found = files.flatMap((file) => straightSpellings(readFileSync(join(ROOT, file), 'utf8'), texts).map((text) => `${file}: "${straight(text)}"`));
    expect(found).toEqual([]);
  });
});
