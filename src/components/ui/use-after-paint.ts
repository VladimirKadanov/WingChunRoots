'use client';

// Work a step behind an interaction, once the frame that answers it has been painted (plan §5.8
// (c), INP). useDeferredValue renders its step in a task right after the urgent commit, before the
// browser's next frame: on a slow phone that render (the lit routes of a large view, the sheet's
// opening) delays the very frame the tap waits for. Here the step starts from a task after the
// next animation frame, so the urgent commit is painted first.
//
// Two tasks after the frame, not one: a task the frame's own callbacks queue (as the "next frame"
// measure of e2e/helpers/explorer-checks.ts does, the INP of WebKit, which has no Event Timing)
// then runs before the step, which never holds back what the interaction is measured by.

import { startTransition, useEffect, useState } from 'react';

/** Calls `run` once the next frame has been painted; returns a function that cancels it. */
export function afterPaint(run: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const frame = requestAnimationFrame(() => {
    timer = setTimeout(() => {
      timer = setTimeout(run);
    });
  });
  return () => {
    cancelAnimationFrame(frame);
    if (timer !== undefined) clearTimeout(timer);
  };
}

/**
 * The value, taken up once the frame after its change has been painted (afterPaint), in a
 * transition, so that a newer interaction still interrupts its render. The first render has the
 * value at once.
 */
export function useAfterPaint<T>(value: T): T {
  const [shown, setShown] = useState(value);
  useEffect(() => {
    if (Object.is(shown, value)) return;
    return afterPaint(() => startTransition(() => setShown(value)));
  }, [value, shown]);
  return shown;
}
