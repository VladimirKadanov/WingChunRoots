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

/** "All rights reserved." after a statement. */
const RESERVED_LINE = /^\s*all rights reserved\.?\s*$/i;

/**
 * A line that continues the statement above it: indented, or starting in lower case or with
 * "<", "(", "&" or a digit ("  and other contributors.", "<mail@example.org>"). A line of licence
 * prose ("Permission is hereby granted, ...") is none of these, so it ends the statements.
 */
const CONTINUATION_LINE = /^(?:\s+\S|[a-z<(&\d])/;

/**
 * Splits a licence text into the copyright statements it opens with and the rest (the body),
 * so packages that use the same licence share one body. Only the leading paragraphs are taken,
 * after an optional title line: a file that bundles several licences keeps the statements of
 * its later sections inside them. In a paragraph that opens with a statement, lines are taken
 * while they are statements, "All rights reserved." or continuations of the statement above
 * (a statement wrapped over two lines stays in one piece); the first other line and everything
 * after it go back to the body (a licence whose grant follows its statement with no blank line
 * in between, as htmlparser2's does). Nothing is dropped: every line is in one of the two parts.
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
      let taken = 0;
      for (const line of lines) {
        if (!(COPYRIGHT_LINE.test(line) || RESERVED_LINE.test(line) || (taken > 0 && CONTINUATION_LINE.test(line)))) break;
        if (!copyright.includes(line.trim())) copyright.push(line.trim());
        taken += 1;
      }
      if (taken === lines.length) continue;
      leading = false;
      body.push(lines.slice(taken).join('\n').replace(/\s+$/, ''));
      continue;
    }
    if (!(leading && !copyright.length && lines.length === 1 && TITLE_LINE.test(first) && first.length < 80)) leading = false;
    body.push(paragraph.replace(/^\n+|\s+$/g, ''));
  }
  return { copyright, body: body.join('\n\n').trim() };
}

/** Licence files at the root of a package: LICENSE, LICENCE.md, COPYING, OFL.txt, LICENSE-MIT.txt, license-cc0, … */
const LICENSE_FILE = /^(?:licen[cs]e|copying|ofl)(?:[-_][a-z0-9][\w-]*)?(?:\.(?:md|txt|markdown))?$/i;
/** The plain names, without a suffix such as "-MIT". */
const PLAIN_LICENSE_FILE = /^(?:licen[cs]e|copying|ofl)(?:\.(?:md|txt|markdown))?$/i;
/** Anything that looks like a licence file, recognised or not. */
const LICENSE_LIKE = /^(?:licen[cs]e|copying|ofl)/i;

/**
 * The licence files of a package directory, by name: the plain one (LICENSE; the first by name
 * when there are several spellings), then every suffixed one, sorted (type-fest ships license-mit
 * and license-cc0 for its dual licence, jsesc LICENSE-MIT.txt, others LICENSE plus a
 * LICENSE-3RD-PARTY.txt for code they bundle). `unrecognised` lists licence-like names that no
 * rule takes, so `pnpm notices` stops instead of listing a package with a licence file as
 * shipping none.
 */
export function pickLicenseFiles(names: readonly string[]): { files: string[]; unrecognised: string[] } {
  const sorted = [...names].sort();
  const plain = sorted.find((name) => PLAIN_LICENSE_FILE.test(name));
  const suffixed = sorted.filter((name) => LICENSE_FILE.test(name) && !PLAIN_LICENSE_FILE.test(name));
  return {
    files: plain ? [plain, ...suffixed] : suffixed,
    unrecognised: sorted.filter((name) => LICENSE_LIKE.test(name) && !LICENSE_FILE.test(name)),
  };
}

/**
 * A REUSE licence folder (https://reuse.software): `LICENSES/` holding one `<SPDX-id>.txt` per
 * licence the package ships under, next to its LICENSE (opencc-js 1.4: MIT for the code, Apache-2.0
 * for the dictionary data). Given the package's file names and whether `LICENSES` is a folder,
 * returns the names to pass to pickLicenseFiles (without the folder) and whether to read the
 * folder's `.txt` files too. Only the exact upper-case name of the REUSE specification counts: any
 * other `licenses` stays unrecognised.
 */
export function reuseLicenseFolder(names: readonly string[], isFolder: (name: string) => boolean): { names: string[]; folder: string | null } {
  const folder = names.includes('LICENSES') && isFolder('LICENSES') ? 'LICENSES' : null;
  return { names: folder ? names.filter((name) => name !== folder) : [...names], folder };
}

/** The licence texts of a REUSE folder: its `<SPDX-id>.txt` files, sorted. */
export function reuseLicenseFiles(names: readonly string[]): string[] {
  return names.filter((name) => /^[A-Za-z0-9.+-]+\.txt$/.test(name)).sort();
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

/**
 * How `pnpm notices` starts pnpm: the pnpm that runs the script (`npm_execpath`, which pnpm sets
 * for every script), so it also works on Windows, where `pnpm` on PATH is only a .cmd, .ps1 or
 * sh shim that execFile cannot start without a shell. pnpm 12 points `npm_execpath` at its
 * native binary, which starts directly; a JavaScript entry (Corepack, an older pnpm) runs through
 * this Node. A bare `pnpm` only when the script runs outside pnpm (or under npm or yarn).
 */
export function pnpmCommand(npmExecPath: string | undefined, nodePath: string): { file: string; args: string[] } {
  // Either separator, whatever the platform this runs on: a Windows path has `\`.
  const name = npmExecPath?.split(/[\\/]/).pop() ?? '';
  if (!npmExecPath || !/^(pnpm|pn)(\.|$)/i.test(name)) return { file: 'pnpm', args: [] };
  return /\.[cm]?js$/i.test(name) ? { file: nodePath, args: [npmExecPath] } : { file: npmExecPath, args: [] };
}
