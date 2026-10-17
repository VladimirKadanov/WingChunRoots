'use client';

// History layers (plan §5.8 (b), M00b): an open sheet or dialog adds one history entry, so the
// Android Back button (and the browser's Back) closes the top layer instead of leaving the page.
// Closing the layer any other way removes the entry again. Next.js copies its own router state
// into entries pushed with history.pushState, so the router keeps working.

import { useEffect, useId, useRef } from 'react';

const KEY = 'wcrLayer';

export function useBackToClose(open: boolean, close: () => void): void {
  const id = useId();
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    window.history.pushState({ ...(window.history.state ?? {}), [KEY]: id }, '');
    let poppedByBack = false;
    const onPopState = () => {
      if ((window.history.state as Record<string, unknown> | null)?.[KEY] !== id) {
        poppedByBack = true;
        closeRef.current();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Closed by a button, Esc or a tap outside: drop the entry this layer added, unless a
      // navigation has replaced it meanwhile.
      if (!poppedByBack && (window.history.state as Record<string, unknown> | null)?.[KEY] === id) {
        window.history.back();
      }
    };
  }, [open, id]);
}
