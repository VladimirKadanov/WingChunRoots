'use client';

// The way into the search palette (milestone M07, In scope 4; plan §5.6): a visible field in the
// app shell (the phone's top bar, the desktop rail) and Ctrl/⌘+K anywhere. A single key such as
// "/" never opens it at page level (WCAG 2.1.4); in the explorer "/" works only while the graph has
// the focus (M06).
//
// One host per page (SearchHost) holds the open state and the shortcut; the fields ask it to open
// with an event. The palette itself (Base UI Autocomplete in a Dialog) loads on first use, so it
// adds nothing to a page's first JavaScript (plan §5.8 (c)).

import { lazy, Suspense, useEffect, useState } from 'react';

import { SearchIcon } from '@/components/icons';
import { cx } from '@/lib/cx';

const OPEN_EVENT = 'wcr:open-search';

const loadPalette = () => import('@/components/ui/search-palette');
const SearchPalette = lazy(loadPalette);

function openSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** Holds the palette for the page: Ctrl/⌘+K, the fields' event, and the palette once it was opened. */
export function SearchHost() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    const show = () => {
      setLoaded(true);
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === 'k' || event.key === 'K') && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
        // Ctrl/⌘+K is the palette's, never the browser's address bar search.
        event.preventDefault();
        show();
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_EVENT, show);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_EVENT, show);
    };
  }, []);
  if (!loaded) return null;
  return (
    <Suspense fallback={null}>
      <SearchPalette open={open} onOpenChange={setOpen} />
    </Suspense>
  );
}

/**
 * The field that opens the palette: a button drawn as a search field, so it reads as one and
 * works with a tap, a click, Enter or Space. `bar` in the phone's top bar, `rail` on desktop.
 */
export function SearchField({ variant }: { variant: 'bar' | 'rail' }) {
  return (
    <button
      type="button"
      onClick={openSearch}
      // The palette's code starts loading as soon as the field is approached.
      onPointerEnter={() => void loadPalette()}
      onFocus={() => void loadPalette()}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      data-search-field={variant}
      className={cx(
        'flex min-h-11 min-w-0 items-center gap-2 rounded-sm border border-border-strong bg-surface-1 text-left text-fg-subtle transition-colors duration-(--duration-fast) hover:border-fg-muted hover:text-fg-muted',
        variant === 'bar' ? 'flex-1 px-3 text-sm' : 'w-full px-3 text-ui',
      )}
    >
      <SearchIcon size={variant === 'bar' ? 18 : 19} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{variant === 'bar' ? 'Search names' : 'Search'}</span>
      {variant === 'rail' ? (
        <kbd aria-hidden="true" className="shrink-0 rounded-[3px] border border-border-subtle px-1.5 font-sans text-xs text-fg-subtle">
          Ctrl K
        </kbd>
      ) : null}
    </button>
  );
}
