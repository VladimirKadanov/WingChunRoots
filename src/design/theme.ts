// Theme selection (plan §5.4, M00b): the page follows prefers-color-scheme until the reader
// picks a theme; the pick lives in the `wcr-theme` cookie ("dark" or "light"; absent means
// "follow the system"). Pure TypeScript, shared by the inline head script, the theme menu and
// the tests.
//
// Why an inline script and not cookies() on the server: with Cache Components, reading a
// cookie in the root layout makes every route request-bound (Next.js 16 guide "Preventing
// flash before hydration"). The static shell stays prerendered and this script, which runs
// while the browser parses <head>, sets data-theme before the first paint (ADR 0006).

import { GROUND, THEME_COOKIE, type ThemeName } from './theme-constants';

export type ThemeChoice = ThemeName | 'system';

/** One year; the choice is a preference, not personal data. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Browser UI colour (theme-color) of each theme: the page ground. */
export const THEME_COLOR: Record<ThemeName, string> = GROUND;

/** Reads the manual choice from a `document.cookie` string. */
export function parseThemeCookie(cookie: string): ThemeName | null {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(dark|light)(?:;|$)`).exec(cookie);
  return (match?.[1] as ThemeName | undefined) ?? null;
}

/** The `Set-Cookie`-style string that stores a choice; "system" deletes the cookie. */
export function themeCookieString(choice: ThemeChoice): string {
  return choice === 'system'
    ? `${THEME_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
    : `${THEME_COOKIE}=${choice}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * The blocking script in <head>. It must stay tiny, dependency-free ES5 and never throw: it
 * sets data-theme from the cookie and points both theme-color metas at the chosen theme.
 */
export const THEME_SCRIPT = `(function(){try{var m=/(?:^|;\\s*)${THEME_COOKIE}=(dark|light)(?:;|$)/.exec(document.cookie);if(!m)return;var t=m[1],d=document.documentElement;d.setAttribute('data-theme',t);var c=t==='light'?'${THEME_COLOR.light}':'${THEME_COLOR.dark}',e=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<e.length;i++)e[i].setAttribute('content',c)}catch(x){}})();`;

/** Applies a choice in the running page (the theme menu). */
export function applyThemeChoice(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  const resolved: ThemeName =
    choice === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : choice;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const media = meta.getAttribute('media');
    // With "system", each meta keeps the colour of the scheme its media query names.
    const theme: ThemeName = choice === 'system' && media ? (media.includes('light') ? 'light' : 'dark') : resolved;
    meta.setAttribute('content', THEME_COLOR[theme]);
  }
  document.cookie = themeCookieString(choice);
}
