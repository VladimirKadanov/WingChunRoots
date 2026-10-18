'use client';

// Focus on arrival (milestone M02 fix round 3, screens-1). A page whose state changes after one of
// its forms while its path and title stay the same (the security page: the setup's first step, the
// backup codes, "Backup codes saved") gets no announcement from Next.js, and focus would stay on the
// body: a screen-reader user would not hear that one-time backup codes are now on screen. The
// element marked with `arrivalProps(true)` (auth-frame.tsx) in this subtree takes the focus when
// `arrival` names a state: on the first render and after a client navigation to another state.
// Without JavaScript the same element carries `autofocus`, which the browser honours at load.
//
// The element is found inside this subtree, not by id: Next.js keeps up to three earlier routes in
// the page, hidden (React Activity), with the same markup.

import { useEffect, useRef, type ReactNode } from 'react';

export function ArrivalFocus({ arrival, children }: { arrival: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!arrival) return;
    ref.current?.querySelector<HTMLElement>('[data-arrival]')?.focus();
  }, [arrival]);
  return (
    <div ref={ref} className="contents">
      {children}
    </div>
  );
}
