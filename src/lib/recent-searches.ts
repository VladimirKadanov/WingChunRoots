// The search palette's recent searches (milestone M07; plan §5.6): kept only in this browser, in
// localStorage, and cleared on sign-out so the next person on a shared device does not see them.
// Every access is wrapped in try/catch: private mode or blocked storage only loses the history.

export const RECENT_SEARCHES_KEY = 'wcr.recent-searches';
export const RECENT_SEARCHES_MAX = 5;

export function readRecentSearches(): string[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(RECENT_SEARCHES_KEY) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, RECENT_SEARCHES_MAX) : [];
  } catch {
    return [];
  }
}

export function writeRecentSearches(list: readonly string[]): void {
  try {
    if (list.length === 0) window.localStorage.removeItem(RECENT_SEARCHES_KEY);
    else window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list.slice(0, RECENT_SEARCHES_MAX)));
  } catch {
    // Private mode or blocked storage: the palette works without its history.
  }
}
