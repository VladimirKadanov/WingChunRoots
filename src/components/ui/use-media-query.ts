'use client';

// A media query as React state, hydration-safe: the server and the first client render assume
// it does not match (phone first), then the browser's answer takes over.
//
// One subscribe function per query, kept at module level, so useSyncExternalStore sees the same
// function on every render and never resubscribes (no hand-written useCallback, plan §3.1).

import { useSyncExternalStore } from 'react';

const subscribers = new Map<string, (onChange: () => void) => () => void>();

function subscriber(query: string) {
  let subscribe = subscribers.get(query);
  if (!subscribe) {
    subscribe = (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    };
    subscribers.set(query, subscribe);
  }
  return subscribe;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscriber(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}
