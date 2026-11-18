'use client';

// After signing out (/sign-in?signed-out=1), the browser forgets the search palette's recent
// searches (src/lib/recent-searches.ts), whichever way the account signed out: the account page's
// form or the shell's account menu, which posts without any script of its own
// (docs/adr/0035-control-panel.md).

import { useEffect } from 'react';

import { SEARCH_RESET_EVENT, writeRecentSearches } from '@/lib/recent-searches';

export function ForgetRecentSearches() {
  useEffect(() => {
    writeRecentSearches([]);
    window.dispatchEvent(new Event(SEARCH_RESET_EVENT));
  }, []);
  return null;
}
