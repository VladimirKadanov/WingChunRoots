'use client';

// Theme switch of the app shell: one press flips between the dark and the light theme (owner
// request 2026-11-02, replacing the System / Light / Dark select). Until the reader presses it,
// the page follows prefers-color-scheme and the switch shows the theme that is on screen; a press
// stores the other theme in the `wcr-theme` cookie (one year), which the inline head script reads
// before the first paint on every later visit (src/design/theme.ts). A real <button
// role="switch">: Space and Enter press it, a screen reader reads "Dark theme, on/off".

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon } from '@/components/icons';
import { applyThemeChoice, parseThemeCookie } from '@/design/theme';
import type { ThemeName } from '@/design/theme-constants';
import { cx } from '@/lib/cx';

const EVENT = 'wcr-theme-change';

function subscribe(onChange: () => void) {
  const media = window.matchMedia('(prefers-color-scheme: light)');
  window.addEventListener(EVENT, onChange);
  media.addEventListener('change', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    media.removeEventListener('change', onChange);
  };
}

/** The theme on screen: the stored choice, else the system's. */
const readTheme = (): ThemeName =>
  parseThemeCookie(document.cookie) ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
// The prerendered shell cannot know it; dark is the design's first theme. Hydration reads the real one.
const serverTheme = (): ThemeName => 'dark';

const LABEL: Record<ThemeName, string> = { light: 'Light', dark: 'Dark' };

export function ThemeMenu({ variant }: { variant: 'icon' | 'row' }) {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme);
  // React resets <html> attributes on a development remount; re-apply the stored choice.
  useLayoutEffect(() => {
    const stored = parseThemeCookie(document.cookie);
    if (stored && document.documentElement.getAttribute('data-theme') !== stored) {
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  const dark = theme === 'dark';
  const Icon = dark ? MoonIcon : SunIcon;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Dark theme"
      onClick={() => {
        applyThemeChoice(dark ? 'light' : 'dark');
        window.dispatchEvent(new Event(EVENT));
      }}
      className={cx(
        'relative inline-flex min-h-11 cursor-pointer items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        variant === 'icon' ? 'size-11 justify-center' : '-ml-2.5 gap-2.5 px-2.5 text-sm',
      )}
    >
      <Icon size={variant === 'icon' ? 22 : 18} />
      {variant === 'row' ? (
        <>
          <span aria-hidden="true">Theme: {LABEL[theme]}</span>
          {/* The track: the knob stands right for dark, left for light (position, not colour alone). */}
          <span aria-hidden="true" className="relative ml-1 inline-block h-5 w-9 shrink-0 rounded-full border border-border-strong bg-surface-2">
            <span
              className={cx(
                'absolute top-0.5 left-0.5 size-3.5 rounded-full bg-fg transition-transform motion-reduce:transition-none',
                dark ? 'translate-x-4' : 'translate-x-0',
              )}
            />
          </span>
        </>
      ) : null}
    </button>
  );
}
