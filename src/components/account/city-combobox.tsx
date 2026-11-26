'use client';

// The city type-ahead (role replay 2026-11-25, P2-12; docs/adr/0071-cities-of-launch-countries.md):
// every place of the GeoNames extract by any spelling, through the public places.search procedure
// on the web's /api/rpc (plan §6.8; /api/v1 is the mobile app's contract), instead of a list of
// the large cities. The ARIA 1.2 combobox pattern: a text field with a list of options under it; the arrow keys move through the options,
// Enter or a tap chooses one, Escape closes the list. The chosen place's id goes in a hidden input
// under the field's name. Rendered only after hydration: without JavaScript each form keeps its
// select of the large cities (and, on the school and event forms, "Find a city or town").

import { useEffect, useId, useRef, useState } from 'react';

import { cx } from '@/lib/cx';
import { fieldClassName } from './fields';

export interface CityChoice {
  id: string;
  name: string;
  countryCode: string;
  /** The place's centre (a city's, never a school's), for a form that shows it on a map. */
  point?: { lat: number; lng: number };
}

const DELAY_MS = 200;

export function CityCombobox({
  id,
  name,
  value,
  onValue,
  countryCode = null,
  describedBy,
  errorId,
  invalid = false,
  disabled = false,
  autoFocus = false,
}: {
  id: string;
  name: string;
  /** The chosen place, or null for none. */
  value: CityChoice | null;
  onValue: (choice: CityChoice | null) => void;
  /** Only the places of this country, when the form has one. */
  countryCode?: string | null;
  describedBy?: string;
  errorId?: string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState(() => (value ? label(value) : ''));
  const [hits, setHits] = useState<CityChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [status, setStatus] = useState<'idle' | 'loading' | 'none' | 'failed'>('idle');
  const request = useRef(0);

  // A place chosen elsewhere (a reset, the country changed) shows its name.
  const shown = value ? label(value) : null;
  const [lastShown, setLastShown] = useState(shown);
  if (shown !== lastShown) {
    setLastShown(shown);
    if (shown !== null) setText(shown);
  }

  const query = text.trim();
  useEffect(() => {
    if (!open || query.length < 2 || (value && query === label(value))) return;
    const ticket = ++request.current;
    const timer = window.setTimeout(async () => {
      setStatus('loading');
      try {
        // oRPC's wire format ({ json: input } -> { json: output }), as the search palette.
        const response = await fetch('/api/rpc/places/search', {
          method: 'POST',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ json: { q: query, ...(countryCode ? { countryCode } : {}) } }),
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = ((await response.json()) as { json: { places: CityChoice[] } }).json;
        if (ticket !== request.current) return;
        setHits(body.places.map(({ id: placeId, name: placeName, countryCode: code, point }) => ({ id: placeId, name: placeName, countryCode: code, ...(point ? { point } : {}) })));
        setActive(-1);
        setStatus(body.places.length ? 'idle' : 'none');
      } catch {
        if (ticket === request.current) setStatus('failed');
      }
    }, DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, query, countryCode, value]);

  const choose = (choice: CityChoice) => {
    onValue(choice);
    setText(label(choice));
    setOpen(false);
    setActive(-1);
  };
  const expanded = open && query.length >= 2 && (hits.length > 0 || status !== 'idle');
  const activeId = active >= 0 && active < hits.length ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      <input type="hidden" name={name} value={value?.id ?? ''} />
      <input
        id={id}
        type="text"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listId}
        aria-activedescendant={expanded ? activeId : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        aria-errormessage={invalid ? errorId : undefined}
        autoComplete="off"
        autoCapitalize="words"
        spellCheck={false}
        enterKeyHint="search"
        maxLength={100}
        disabled={disabled}
        autoFocus={autoFocus}
        value={text}
        onChange={(event) => {
          setText(event.currentTarget.value);
          setOpen(true);
          if (value) onValue(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            if (hits.length === 0) return;
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setActive((current) => (current + step + hits.length) % hits.length);
          } else if (event.key === 'Enter' && expanded && activeId) {
            event.preventDefault();
            choose(hits[active]!);
          } else if (event.key === 'Escape' && expanded) {
            event.preventDefault();
            setOpen(false);
          }
        }}
        className={fieldClassName}
      />
      <ul
        id={listId}
        role="listbox"
        aria-label="Cities and towns"
        hidden={!expanded}
        className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-sm border border-border-subtle bg-surface-2 p-1 shadow-pop"
      >
        {hits.map((hit, index) => (
          <li
            key={hit.id}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={index === active}
            // Chosen on pointer down, before the field's blur closes the list.
            onPointerDown={(event) => {
              event.preventDefault();
              choose(hit);
            }}
            className={cx('flex min-h-11 cursor-pointer items-center rounded-sm px-3 text-ui', index === active ? 'bg-surface-3 font-semibold' : 'hover:bg-surface-3')}
          >
            {label(hit)}
          </li>
        ))}
        {status !== 'idle' && hits.length === 0 ? (
          <li role="presentation" className="px-3 py-2.5 text-sm text-fg-muted">
            {status === 'loading' ? 'Looking…' : status === 'failed' ? 'The cities could not be loaded just now. Try again.' : 'No city or town by that name.'}
          </li>
        ) : null}
      </ul>
    </div>
  );
}

function label(choice: CityChoice): string {
  return `${choice.name}, ${choice.countryCode}`;
}
