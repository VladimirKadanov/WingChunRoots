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
  /** Index of the package's own licence file in `texts`, or null when it ships none. */
  text: number | null;
}

export interface Addendum {
  file: string;
  title: string;
  body: string;
}

export interface NoticesData {
  notices: Notice[];
  /** Each distinct licence text once, verbatim (normalised line endings). */
  texts: string[];
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

/** One notice per name@version, sorted, with each distinct licence text stored once. */
export function dedupe(raw: RawNotice[], addenda: Addendum[]): NoticesData {
  const unique = new Map<string, RawNotice>();
  for (const notice of raw) unique.set(`${notice.name}@${notice.version}`, unique.get(`${notice.name}@${notice.version}`) ?? notice);
  const sorted = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en'));
  const texts: string[] = [];
  const index = new Map<string, number>();
  const notices = sorted.map((notice) => {
    let text: number | null = null;
    if (notice.text !== null) {
      text = index.get(notice.text) ?? texts.length;
      if (text === texts.length) {
        texts.push(notice.text);
        index.set(notice.text, text);
      }
    }
    return { ...notice, text };
  });
  return { notices, texts, addenda };
}

/** Versions of `name` in a pnpm-lock.yaml (its `packages:` keys). */
export function lockedVersions(lockfile: string, name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = new RegExp(`^  '?${escaped}@([^'(:\\s]+)`, 'gm');
  return [...new Set([...lockfile.matchAll(pattern)].map((m) => m[1]!))].sort();
}
