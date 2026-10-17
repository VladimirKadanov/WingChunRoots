// The few token values that the browser needs on every page: the theme cookie's name and the
// page ground of each theme (the theme-color of the browser UI). A leaf module, so the theme
// switch and the inline head script load these and not the whole of src/design/tokens.ts.
// tokens.ts builds its palettes from GROUND, so there is still one source.

export const THEMES = ['dark', 'light'] as const;
export type ThemeName = (typeof THEMES)[number];

/** Cookie that keeps a manual theme choice ("dark" or "light"); absent means "follow the system". */
export const THEME_COOKIE = 'wcr-theme';

/** The page ground of each theme: black lacquer (dark) and rice paper (light). */
export const GROUND: Record<ThemeName, string> = {
  dark: '#121214',
  light: '#EDEBE5',
};
