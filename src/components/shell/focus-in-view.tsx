'use client';

// Keeps a page control that takes keyboard focus clear of what covers the window's edges: the
// sticky top bar, the phone tab bar and an open non-modal sheet (WCAG 2.4.11). globals.css sets
// that room as the root's scroll padding, which Chromium applies when focus scrolls. WebKit
// (Safari, iOS webviews) can leave a focused control under the bars or below the window, so after
// the browser's own scroll this checks the control against the padding and scrolls the rest.
// Only a focus while the keyboard is in use (the last input was a key, not a press) is checked:
// scrolling in the middle of a click could move the control out from under the pointer and lose
// the click, and a pressed control is on screen already. Controls in a sheet are the sheet's own
// business (Drawer expands itself); only the page in <main> is checked.

import { useEffect } from 'react';

export function FocusInView() {
  useEffect(() => {
    let keyboard = false;
    const onKey = () => {
      keyboard = true;
    };
    const onPress = () => {
      keyboard = false;
    };
    const onFocus = (event: FocusEvent) => {
      const el = event.target;
      if (!keyboard || !(el instanceof Element)) return;
      if (!document.getElementById('main')?.contains(el)) return;
      // After the browser has scrolled (or not).
      requestAnimationFrame(() => {
        if (document.activeElement !== el) return;
        const root = getComputedStyle(document.documentElement);
        const top = Number.parseFloat(root.scrollPaddingTop) || 0;
        const bottom = window.innerHeight - (Number.parseFloat(root.scrollPaddingBottom) || 0);
        const box = el.getBoundingClientRect();
        // Below the clear band: up until its bottom shows, never past its top. Above it: down.
        if (box.bottom > bottom) window.scrollBy(0, Math.max(0, Math.min(box.bottom - bottom, box.top - top)));
        else if (box.top < top) window.scrollBy(0, box.top - top);
      });
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('focusin', onFocus);
    };
  }, []);
  return null;
}
