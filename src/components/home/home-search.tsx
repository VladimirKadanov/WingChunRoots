'use client';

// The home page's way into the real search (milestone M13, In scope 1; plan §5.5): a button
// drawn as a search field that opens the command palette of the app shell (the same palette as
// the shell's field and Ctrl/⌘+K, M07). The palette's code starts loading as the field is
// approached, so it adds nothing to the page's first JavaScript (plan §5.8 (c)).

import { SearchIcon } from '@/components/icons';
import { openSearch } from '@/components/shell/search-trigger';

const loadPalette = () => import('@/components/ui/search-palette');

export function HomeSearch() {
  return (
    <button
      type="button"
      onClick={openSearch}
      onPointerEnter={() => void loadPalette()}
      onFocus={() => void loadPalette()}
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      data-home-search=""
      className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-sm border border-border-strong bg-surface-1 px-4 text-left text-base text-fg-muted transition-colors duration-(--duration-fast) hover:border-fg-muted hover:text-fg"
    >
      <SearchIcon size={20} className="shrink-0" />
      <span className="min-w-0 flex-1">Search people, schools and lineages</span>
    </button>
  );
}
