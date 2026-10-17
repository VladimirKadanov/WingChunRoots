import { describe, expect, it } from 'vitest';
import { dedupe, flatten, lockedVersions, safeHomepage } from './notices';

describe('safeHomepage', () => {
  it('keeps http and https', () => {
    expect(safeHomepage(' https://example.org/a ')).toBe('https://example.org/a');
    expect(safeHomepage('http://example.org')).toBe('http://example.org/');
  });
  it('drops every other scheme and non-URLs', () => {
    for (const value of ['javascript:alert(1)', 'git+ssh://git@example.org/x.git', 'data:text/html,x', '/relative', 'example.org', '', null, undefined])
      expect(safeHomepage(value)).toBeNull();
  });
});

describe('flatten and dedupe', () => {
  const texts: Record<string, string> = { '/a': 'MIT text A', '/b': 'MIT text A', '/c': 'Apache text' };
  const raw = flatten(
    {
      MIT: [
        { name: 'b', versions: ['1.0.0'], paths: ['/b'], license: 'MIT', homepage: 'javascript:void(0)' },
        { name: 'a', versions: ['2.0.0', '1.0.0'], paths: ['/a', '/a'], license: 'MIT', author: ' Someone ' },
      ],
      'Apache-2.0': [{ name: 'c', versions: ['3.0.0'], paths: ['/c'], license: 'Apache-2.0', homepage: 'https://c.example' }],
      ISC: [{ name: 'd', versions: ['1.0.0'], paths: ['/none'], license: 'ISC' }],
    },
    (dir) => texts[dir] ?? null,
  );

  it('lists one notice per version, sorted, with safe home pages', () => {
    const data = dedupe([...raw, ...raw], []);
    expect(data.notices.map((n) => `${n.name}@${n.version}`)).toEqual(['a@1.0.0', 'a@2.0.0', 'b@1.0.0', 'c@3.0.0', 'd@1.0.0']);
    expect(data.notices.find((n) => n.name === 'b')!.homepage).toBeNull();
    expect(data.notices.find((n) => n.name === 'a')!.author).toBe('Someone');
  });

  it('stores each distinct text once and points every package at it', () => {
    const data = dedupe(raw, []);
    expect(data.texts).toEqual(['MIT text A', 'Apache text']);
    for (const notice of data.notices) {
      const expected = notice.name === 'd' ? null : texts[`/${notice.name}`];
      expect(notice.text === null ? null : data.texts[notice.text]).toBe(expected);
    }
  });

  it('keeps only the named packages when asked', () => {
    expect(flatten({ MIT: [{ name: 'x', versions: ['1'], paths: [''], license: 'MIT' }, { name: 'y', versions: ['1'], paths: [''], license: 'MIT' }] }, () => null, ['y']).map((n) => n.name)).toEqual(['y']);
  });
});

describe('lockedVersions', () => {
  const lock = ["packages:", "", "  '@img/sharp-libvips-linux-x64@1.3.4':", '    resolution: {}', '  sharp@0.35.5:', '  sharp@0.35.5(@types/node@24.19.2):', '  sharpie@1.0.0:'].join('\n');
  it('reads the versions of a package, scoped or not', () => {
    expect(lockedVersions(lock, 'sharp')).toEqual(['0.35.5']);
    expect(lockedVersions(lock, '@img/sharp-libvips-linux-x64')).toEqual(['1.3.4']);
    expect(lockedVersions(lock, 'missing')).toEqual([]);
  });
});
