import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { THEME_COLOR, THEME_SCRIPT, parseThemeCookie, themeCookieString } from './theme';

describe('theme cookie', () => {
  it('reads only "dark" or "light"', () => {
    expect(parseThemeCookie('a=1; wcr-theme=light; b=2')).toBe('light');
    expect(parseThemeCookie('wcr-theme=dark')).toBe('dark');
    expect(parseThemeCookie('wcr-theme=blue')).toBeNull();
    expect(parseThemeCookie('xwcr-theme=light')).toBeNull();
    expect(parseThemeCookie('')).toBeNull();
  });
  it('"system" deletes the cookie', () => {
    expect(themeCookieString('system')).toContain('Max-Age=0');
    expect(themeCookieString('light')).toMatch(/^wcr-theme=light; Path=\/; Max-Age=\d+; SameSite=Lax$/);
  });
});

describe('the inline head script', () => {
  function run(cookie: string) {
    const attrs: Record<string, string> = {};
    const metas = [{ content: THEME_COLOR.dark }, { content: THEME_COLOR.light }].map((meta) => ({
      setAttribute: (_: string, value: string) => {
        meta.content = value;
      },
      get content() {
        return meta.content;
      },
    }));
    const document = {
      cookie,
      documentElement: { setAttribute: (name: string, value: string) => (attrs[name] = value) },
      querySelectorAll: () => metas,
    };
    runInNewContext(THEME_SCRIPT, { document });
    return { attrs, metas: metas.map((m) => m.content) };
  }
  it('sets data-theme and both theme-color metas from the cookie', () => {
    expect(run('wcr-theme=light')).toEqual({ attrs: { 'data-theme': 'light' }, metas: [THEME_COLOR.light, THEME_COLOR.light] });
  });
  it('leaves the page to prefers-color-scheme without a cookie', () => {
    expect(run('other=1')).toEqual({ attrs: {}, metas: [THEME_COLOR.dark, THEME_COLOR.light] });
  });
  it('never throws', () => {
    expect(() => runInNewContext(THEME_SCRIPT, {})).not.toThrow();
  });
});
