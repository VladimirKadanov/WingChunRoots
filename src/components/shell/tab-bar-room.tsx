'use client';

// Publishes the real height of the phone tab bar on <html> as --tab-bar (without the home
// indicator's inset). The bar's labels are sized in rem, so it grows with the reader's text
// (67 px at 150 %, 89 px at 200 %), while the --tab-h token is its smallest height. Everything
// that keeps clear of the bar (scroll padding, <main>'s padding, a non-modal sheet's bottom edge,
// toasts) reads --tab-clear in globals.css, which uses --tab-bar once this has run and the
// token before. From 768 px the nav is the side rail and nothing is published.

import { useEffect } from 'react';

export function TabBarRoom() {
  useEffect(() => {
    const nav = document.querySelector<HTMLElement>('[data-tab-bar]');
    const bar = nav?.firstElementChild;
    if (!nav || !(bar instanceof HTMLElement) || typeof ResizeObserver !== 'function') return;
    const root = document.documentElement.style;
    const update = () => {
      if (getComputedStyle(nav).position !== 'fixed') {
        root.removeProperty('--tab-bar');
        return;
      }
      // The inner bar pads the bottom with env(safe-area-inset-bottom); --tab-clear adds it back.
      const inset = Number.parseFloat(getComputedStyle(bar).paddingBottom) || 0;
      root.setProperty('--tab-bar', `${Math.round((nav.getBoundingClientRect().height - inset) * 100) / 100}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(nav);
    return () => {
      observer.disconnect();
      root.removeProperty('--tab-bar');
    };
  }, []);
  return null;
}
