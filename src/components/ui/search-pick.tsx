'use client';

// "Find by name" beside a field that takes a public address (role replay 2026-11-25, P2-4,
// docs/adr/0064-pick-by-name.md): the search palette in select mode (people, or schools) writes the
// chosen result's address (its slug) into the field and says whom it chose. The field stays a plain
// text field that the form posts as before, so the form works without JavaScript and a typed
// address still works; this button appears only once the page has its script. The palette's code
// loads on the first hover, focus or press.

import { lazy, Suspense, useState, useSyncExternalStore } from 'react';

import { SearchIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import type { PersonHit, SchoolHit } from '@/components/ui/search-palette';
import { cx } from '@/lib/cx';

const loadPalette = () => import('@/components/ui/search-palette');
const SearchPalette = lazy(loadPalette);

const subscribe = () => () => {};

export interface SearchPickWords {
  /** The button ("Find by name"). */
  find: string;
  /** The dialog's name ("Choose a person"). */
  dialog: string;
  /** What the dialog says before anything is typed. */
  hint: string;
  /** The line under the field once chosen; {name} is the chosen name ("Chosen: {name}"). */
  chosen: string;
}

export function SearchPick({ inputId, kind = 'person', words, className }: { inputId: string; kind?: 'person' | 'school'; words: SearchPickWords; className?: string }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  if (!hydrated) return null;

  const fill = (slug: string, name: string) => {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.value = slug;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
    setChosen(name);
  };
  const onPerson = (hit: PersonHit) => fill(hit.slug, hit.displayName.value);
  const onSchool = (hit: SchoolHit) => fill(hit.slug, hit.city ? `${hit.name}, ${hit.city}` : hit.name);

  return (
    <div className={cx('grid justify-items-start gap-1.5', className)}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-controls={inputId}
        onClick={() => {
          setLoaded(true);
          setOpen(true);
        }}
        onPointerEnter={() => void loadPalette()}
        onFocus={() => void loadPalette()}
        className={buttonVariants({ variant: 'secondary' })}
        data-testid="search-pick"
      >
        <SearchIcon />
        {words.find}
      </button>
      <p role="status" className="text-sm text-fg-muted" data-testid="search-pick-chosen">
        {chosen ? (
          <span translate="no">{words.chosen.replace('{name}', chosen)}</span>
        ) : null}
      </p>
      {loaded ? (
        <Suspense fallback={null}>
          <SearchPalette
            open={open}
            onOpenChange={setOpen}
            {...(kind === 'school' ? { onSelectSchool: onSchool } : { onSelect: onPerson })}
            selectLabel={words.dialog}
            selectHint={words.hint}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
