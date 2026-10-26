// The search palette's shortcut, Ctrl/⌘+K (milestone M07; plan §5.6), as one test for a keydown.
//
// The letter is the layout's: Dvorak and AZERTY users press their own "k". A layout without Latin
// letters (Bulgarian, Russian, Greek, …) reports its own letter there ("к" or "л"), so only then
// the physical key, KeyK, counts: a Bulgarian user who has just typed a Cyrillic name still opens
// the palette instead of moving to the browser's address bar.

/** The fields of a keydown event this test reads. */
export interface ShortcutKey {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function isSearchShortcut(event: ShortcutKey): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  return event.key.toLowerCase() === 'k' || (!/^[a-z]$/i.test(event.key) && event.code === 'KeyK');
}
