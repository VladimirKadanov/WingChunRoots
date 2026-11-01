'use client';

// The theme the page shows (src/design/theme.ts): html[data-theme] when the reader chose one,
// otherwise the system's colour scheme. As React state, so the map can follow a change of either
// (milestone M11: the map switches its style together with the theme). Hydration-safe: the server
// and the first client render assume dark, the default theme (docs/design/direction.md).

import { useSyncExternalStore } from 'react';

import type { ThemeName } from '@/design/theme-constants';

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const media = window.matchMedia('(prefers-color-scheme: light)');
  media.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    media.removeEventListener('change', onChange);
  };
}

function current(): ThemeName {
  const chosen = document.documentElement.getAttribute('data-theme');
  if (chosen === 'light' || chosen === 'dark') return chosen;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function usePageTheme(): ThemeName {
  return useSyncExternalStore(subscribe, current, () => 'dark');
}
