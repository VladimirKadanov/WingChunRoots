'use client';

// Theme switch of the app shell: System (follow prefers-color-scheme), Light or Dark. A native
// <select> laid over the icon or the "Theme: …" row: the platform picker on phones and in
// webviews, full keyboard and screen reader support, and no popup code in every page's
// JavaScript (plan §5.8 (c)). The choice is stored in a cookie that the inline head script reads
// before the first paint (src/design/theme.ts).

import { useLayoutEffect, useSyncExternalStore } from 'react';
import { MoonIcon, SunIcon, SystemThemeIcon } from '@/components/icons';
import { applyThemeChoice, parseThemeCookie, type ThemeChoice } from '@/design/theme';
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

const readChoice = (): ThemeChoice => parseThemeCookie(document.cookie) ?? 'system';
const serverChoice = (): ThemeChoice => 'system';

const LABEL: Record<ThemeChoice, string> = { system: 'System', light: 'Light', dark: 'Dark' };
const OPTION: Record<ThemeChoice, string> = { system: 'Match the system', light: 'Light', dark: 'Dark' };
const ICON = { system: SystemThemeIcon, light: SunIcon, dark: MoonIcon } as const;

export function ThemeMenu({ variant }: { variant: 'icon' | 'row' }) {
  const choice = useSyncExternalStore(subscribe, readChoice, serverChoice);
  // React resets <html> attributes on a development remount; re-apply the stored choice.
  useLayoutEffect(() => {
    const stored = parseThemeCookie(document.cookie);
    if (stored && document.documentElement.getAttribute('data-theme') !== stored) {
      document.documentElement.setAttribute('data-theme', stored);
    }
  }, []);

  const Icon = ICON[choice];

  return (
    <label
      className={cx(
        'relative inline-flex min-h-11 items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg',
        'has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus',
        variant === 'icon' ? 'size-11 justify-center' : '-ml-2.5 gap-2.5 px-2.5 text-sm',
      )}
    >
      <Icon size={variant === 'icon' ? 22 : 18} />
      {variant === 'row' ? <span aria-hidden="true">Theme: {LABEL[choice]}</span> : null}
      <select
        aria-label="Theme"
        value={choice}
        onChange={(event) => {
          applyThemeChoice(event.target.value as ThemeChoice);
          window.dispatchEvent(new Event(EVENT));
        }}
        // 16 px: iOS zooms the page into a focused control with smaller text.
        className="absolute inset-0 size-full cursor-pointer appearance-none text-field opacity-0"
      >
        {(['system', 'light', 'dark'] as const).map((value) => (
          <option key={value} value={value}>
            {OPTION[value]}
          </option>
        ))}
      </select>
    </label>
  );
}
