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
//
// The on-screen keyboard is the exception. While a text field of the page has focus and the
// window is at least KEYBOARD_PX shorter than it was at this width, the keyboard is up: the root
// gets `data-keyboard` (globals.css then moves the phone tab bar aside, since a webview that
// resizes for the keyboard would carry the fixed bar up over the form), and the focused field,
// however it got the focus, is brought back above the keyboard and the top bar. A focus alone is
// not enough: a field focused on load (autofocus) opens no keyboard, and the bar stays.

import { useEffect } from 'react';

/** Less than any phone keyboard, more than a browser's collapsing address bar. */
const KEYBOARD_PX = 150;

/** The fields that open the on-screen keyboard. */
const TEXT_FIELD =
  'input:not([type="checkbox"], [type="radio"], [type="submit"], [type="button"], [type="reset"], [type="hidden"], [type="range"], [type="color"], [type="file"]), textarea';

export function FocusInView() {
  useEffect(() => {
    let keyboard = false;
    const onKey = () => {
      keyboard = true;
    };
    const onPress = () => {
      keyboard = false;
    };
    const keepInView = (el: Element) => {
      // After the browser has scrolled (or not).
      requestAnimationFrame(() => {
        if (document.activeElement !== el) return;
        const root = getComputedStyle(document.documentElement);
        const top = Number.parseFloat(root.scrollPaddingTop) || 0;
        // The visual viewport ends above an open on-screen keyboard; the layout viewport may not.
        const height = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
        const bottom = height - (Number.parseFloat(root.scrollPaddingBottom) || 0);
        const box = el.getBoundingClientRect();
        // Below the clear band: up until its bottom shows, never past its top. Above it: down.
        if (box.bottom > bottom) window.scrollBy(0, Math.max(0, Math.min(box.bottom - bottom, box.top - top)));
        else if (box.top < top) window.scrollBy(0, box.top - top);
      });
    };
    const inPage = (el: unknown): el is Element => el instanceof Element && Boolean(document.getElementById('main')?.contains(el));
    const onFocus = (event: FocusEvent) => {
      if (keyboard && inPage(event.target)) keepInView(event.target);
    };

    // The window's height at scale 1 (a pinch zoom shrinks the visual viewport, not the window),
    // and the tallest it has been at the current width.
    const windowHeight = () => {
      const viewport = window.visualViewport;
      return viewport ? viewport.height * viewport.scale : window.innerHeight;
    };
    let seen = { width: window.innerWidth, height: windowHeight() };
    const update = () => {
      const width = window.innerWidth;
      const height = windowHeight();
      if (width !== seen.width) seen = { width, height };
      else seen.height = Math.max(seen.height, height);
      const el = document.activeElement;
      const open = inPage(el) && el.matches(TEXT_FIELD) && height < seen.height - KEYBOARD_PX;
      const was = document.documentElement.hasAttribute('data-keyboard');
      document.documentElement.toggleAttribute('data-keyboard', open);
      if (open && !was && el) keepInView(el);
    };
    // After the focus has settled: a focusout is followed by the next control's focusin.
    const onFocusChange = () => requestAnimationFrame(update);

    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    document.addEventListener('focusin', onFocus);
    document.addEventListener('focusin', onFocusChange);
    document.addEventListener('focusout', onFocusChange);
    window.visualViewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      document.removeEventListener('focusin', onFocus);
      document.removeEventListener('focusin', onFocusChange);
      document.removeEventListener('focusout', onFocusChange);
      window.visualViewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.documentElement.removeAttribute('data-keyboard');
    };
  }, []);
  return null;
}
