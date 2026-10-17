// Pure parts of `pnpm notices` (scripts/generate-notices.ts), unit-tested in notices.test.ts.

export interface PnpmPackage {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  author?: string;
  homepage?: string;
}

export interface Notice {
  name: string;
  version: string;
  license: string;
  author: string | null;
  /** An http(s) home page, or null. */
  homepage: string | null;
  /**
   * Index of the body of the package's own licence file in `texts`, or null when it ships none.
   * The body is the text without its leading copyright statements, which are in `holders`.
   */
  text: number | null;
}

/** A copyright statement and the packages whose licence file opens with it. */
export interface Holder {
  line: string;
  packages: string[];
}

export interface Addendum {
  file: string;
  title: string;
  body: string;
}

export interface NoticesData {
  notices: Notice[];
  /**
   * Each distinct licence body once, verbatim (normalised line endings) apart from the copyright
   * lines, which are kept per package: MIT, ISC and BSD texts differ only in those lines.
   */
  texts: string[];
  /** For each text, the copyright statements taken out of it, each with its packages. */
  holders: Holder[][];
  addenda: Addendum[];
}

/** Packages of the development tree whose output ships: Tailwind's preflight is in the app's CSS. */
export const SHIPPED_BUILD_OUTPUT = ['tailwindcss'] as const;

/** Only http(s) home pages become links; anything else (javascript:, git+ssh:, a bare path) is dropped. */
export function safeHomepage(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

export interface RawNotice extends Omit<Notice, 'text'> {
  text: string | null;
}

/** A copyright statement: "Copyright" followed by (c), © or a year, or (c) / © with a year. */
const COPYRIGHT_LINE = /^\s*(?:copyright\s*(?:\(c\)|©|\d{4})|\(c\)\s*\d{4}|©\s*\d{4})/i;

/** A one-line title such as "MIT License" or "The ISC License". */
const TITLE_LINE = /licen[cs]e/i;

/**
 * Splits a licence text into the copyright statements it opens with and the rest (the body),
 * so packages that use the same licence share one body. Only the leading paragraphs are taken,
 * whole (a statement wrapped over two lines, or followed by "All rights reserved.", stays in one
 * piece), after an optional title line: a file that bundles several licences keeps the statements
 * of its later sections inside them. Nothing is dropped: every line is in one of the two parts.
 */
export function splitCopyright(text: string): { copyright: string[]; body: string } {
  const copyright: string[] = [];
  const body: string[] = [];
  let leading = true;
  for (const paragraph of text.split(/\n[ \t]*\n/)) {
    const lines = paragraph.split('\n').filter((line) => line.trim());
    if (!lines.length) continue;
    const first = lines[0]!.trim();
    if (leading && COPYRIGHT_LINE.test(first)) {
      for (const line of lines) if (!copyright.includes(line.trim())) copyright.push(line.trim());
      continue;
    }
    if (!(leading && !copyright.length && lines.length === 1 && TITLE_LINE.test(first) && first.length < 80)) leading = false;
    body.push(paragraph.replace(/^\n+|\s+$/g, ''));
  }
  return { copyright, body: body.join('\n\n').trim() };
}

/** Flattens pnpm's licence list (one entry per version), keeping only `include` when given. */
export function flatten(
  byLicense: Record<string, PnpmPackage[]>,
  readText: (dir: string) => string | null,
  include?: readonly string[],
): RawNotice[] {
  const out: RawNotice[] = [];
  for (const packages of Object.values(byLicense)) {
    for (const pkg of packages) {
      if (include && !include.includes(pkg.name)) continue;
      pkg.versions.forEach((version, i) => {
        out.push({
          name: pkg.name,
          version,
          license: pkg.license,
          author: pkg.author?.trim() || null,
          homepage: safeHomepage(pkg.homepage),
          text: readText(pkg.paths[i] ?? pkg.paths[0] ?? ''),
        });
      });
    }
  }
  return out;
}

/** One notice per name@version, sorted, with each distinct licence body stored once. */
export function dedupe(raw: RawNotice[], addenda: Addendum[]): NoticesData {
  const unique = new Map<string, RawNotice>();
  for (const notice of raw) unique.set(`${notice.name}@${notice.version}`, unique.get(`${notice.name}@${notice.version}`) ?? notice);
  const sorted = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  const texts: string[] = [];
  const holders: Map<string, string[]>[] = [];
  const index = new Map<string, number>();
  const notices = sorted.map((notice) => {
    let text: number | null = null;
    if (notice.text !== null) {
      const split = splitCopyright(notice.text);
      text = index.get(split.body) ?? texts.length;
      if (text === texts.length) {
        texts.push(split.body);
        holders.push(new Map());
        index.set(split.body, text);
      }
      const lines = holders[text]!;
      for (const line of split.copyright) lines.set(line, [...(lines.get(line) ?? []), `${notice.name} ${notice.version}`]);
    }
    return { ...notice, text };
  });
  return {
    notices,
    texts,
    holders: holders.map((lines) => [...lines.entries()].map(([line, packages]) => ({ line, packages }))),
    addenda,
  };
}

/** Versions of `name` in a pnpm-lock.yaml (its `packages:` keys). */
export function lockedVersions(lockfile: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = new RegExp(`^  '?${escaped}@([^'(:\\s]+)`, 'gm');
  return [...new Set([...lockfile.matchAll(pattern)].map((m) => m[1]!))].sort();
}
