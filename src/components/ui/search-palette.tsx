'use client';

// The search palette (milestone M07, In scope 4; plan §5.6): Base UI Autocomplete inside a Dialog.
//
// - Opened from the field in the app shell or with Ctrl/⌘+K (src/components/shell/search-trigger.tsx).
//   There is no page-wide "/" key (WCAG 2.1.4).
// - Searches on the server (search.query through the web's oRPC endpoint, POST
//   /api/rpc/search/query; plan §6.8) after a 200 ms pause, aborts a stale request and keeps the
//   previous results on screen while the next ones load. Enter never opens one of those earlier
//   rows: while the search for the query in the field is pending, it runs at once and its first
//   result opens.
// - Never searches during IME composition (compositionstart … compositionend, isComposing): a
//   Chinese name is searched once it is composed. Not on Android, whose keyboards compose every
//   Latin or Cyrillic word (docs/search.md).
// - Groups the results under People, Schools and Lineages. A person shows its display name, the
//   stored name the query matched (person_name; never a generated pinyin or Jyutping key), and the
//   city or lineage that tells namesakes apart.
// - Enter opens the highlighted result; Ctrl/⌘+Enter opens a person in the explorer,
//   /explore?focus=<id>.
// - The last searches stay in this browser only (localStorage, with try/catch) and can be cleared.
//   Every opening reads them again and starts with an empty field.
// - On a phone it fills the screen (dvh, safe areas) and results are chosen by touch (a touch press on
//   a result is never cancelled: WebKit's GTK and WPE ports send no click after one); Back closes it.
//   The sheet and the keyboard hints need room in both directions (SHEET_QUERY): a phone in
//   landscape keeps the full screen.

import { Autocomplete } from '@base-ui/react/autocomplete';
import { Dialog } from '@base-ui/react/dialog';
import { useRouter } from 'next/navigation';
import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';

import { ArrowRightIcon, CloseIcon, SearchIcon } from '@/components/icons';
import { Seal } from '@/components/ink/seal';
import { cx } from '@/lib/cx';
import { RECENT_SEARCHES_MAX, readRecentSearches, writeRecentSearches } from '@/lib/recent-searches';
import { releaseLayerEntry, useBackToClose } from './use-back-to-close';
import { useMediaQuery } from './use-media-query';

/** The search answer (src/server/dto/search.ts), as the browser receives it. */
interface SearchName {
  value: string;
  lang: string;
  script: string;
}
interface SearchAnswer {
  query: string;
  /** More people match than the list holds (LIMITS.people, src/server/search/query.ts). */
  morePeople: boolean;
  people: {
    id: string;
    slug: string;
    displayName: SearchName;
    matched: SearchName | null;
    city: string | null;
    countryCode: string | null;
    lineageName: string | null;
    verified: boolean;
  }[];
  schools: { id: string; slug: string; name: string; city: string; countryCode: string; instructor: { slug: string; displayName: SearchName } | null }[];
  lineages: { id: string; slug: string; name: string; root: { slug: string; displayName: SearchName } }[];
}

type Item =
  | { kind: 'person'; key: string; label: string; href: string; explore: string; hit: SearchAnswer['people'][number] }
  | { kind: 'school'; key: string; label: string; href: string; hit: SearchAnswer['schools'][number] }
  | { kind: 'lineage'; key: string; label: string; href: string; hit: SearchAnswer['lineages'][number] }
  | { kind: 'page'; key: string; label: string; href: string }
  | { kind: 'recent'; key: string; label: string };

interface Group {
  value: string;
  items: Item[];
}

/** The pause after the last keystroke before the search runs (plan §5.6). */
export const SEARCH_DEBOUNCE_MS = 200;
/**
 * The sheet and the keyboard hints, the same as the `sheet:` variant of src/app/globals.css: from
 * 640 px wide and 512 px high. Narrower, or lower (a phone in landscape), the palette fills the screen.
 */
const SHEET_QUERY = '(min-width: 40rem) and (min-height: 32rem)';
/**
 * Android keyboards (Gboard, Samsung) send every Latin or Cyrillic word as a composition, so the
 * composition gate would stop search-as-you-type there; Base UI drops its own composition
 * tracking on Android for the same reason (mui/base-ui#2942). The cost, an Android Chinese input
 * method's Latin letters being searched too, is in docs/search.md.
 */
const ANDROID = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
/** Pages of the app the palette offers by their title (plan §5.6: the Pages group). */
const PAGES: readonly { label: string; href: string }[] = [
  { label: 'Explore', href: '/' },
  { label: 'Plans', href: '/plans' },
  { label: 'Your dashboard', href: '/dashboard' },
  { label: 'Your profile', href: '/dashboard/profile' },
  { label: 'Account type and plan', href: '/dashboard/settings' },
  { label: 'Your account', href: '/account' },
  { label: 'Security settings', href: '/account/security' },
  { label: 'Privacy and consents', href: '/account/privacy' },
  { label: 'Terms of use', href: '/legal/terms' },
  { label: 'Privacy notice', href: '/legal/privacy' },
  { label: 'Licenses', href: '/legal/licenses' },
  { label: 'Sign in', href: '/sign-in' },
  { label: 'Create an account', href: '/sign-up' },
];

/** The pages whose title has a word starting with the query (two letters or more). */
function pagesFor(query: string): Item[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return PAGES.filter((page) => page.label.toLowerCase().split(/\s+/).some((word) => word.startsWith(q)) || page.label.toLowerCase().startsWith(q)).map(
    (page) => ({ kind: 'page' as const, key: `page:${page.href}`, label: page.label, href: page.href }),
  );
}

const regionNames = typeof Intl !== 'undefined' ? new Intl.DisplayNames('en', { type: 'region', fallback: 'code' }) : null;
const countryName = (code: string | null) => (code ? (regionNames?.of(code) ?? code) : null);

const isChinese = (lang: string) => (lang === 'zh' || lang.startsWith('zh-') || lang.startsWith('yue-Han')) && !lang.includes('Latn');

function Name({ name, className }: { name: SearchName; className?: string }) {
  return (
    <span lang={name.lang} translate="no" className={cx(isChinese(name.lang) && 'cjk', className)}>
      {name.value}
    </span>
  );
}

function groupsOf(answer: SearchAnswer | null, query: string): Group[] {
  const groups: Group[] = [];
  const pages = pagesFor(query);
  if (!answer) return pages.length > 0 ? [{ value: 'Pages', items: pages }] : [];
  if (answer.people.length > 0) {
    groups.push({
      value: 'People',
      items: answer.people.map((hit) => ({
        kind: 'person' as const,
        key: `person:${hit.id}`,
        label: hit.displayName.value,
        href: `/people/${hit.slug}`,
        explore: `/explore?focus=${hit.id}`,
        hit,
      })),
    });
  }
  if (answer.schools.length > 0) {
    groups.push({
      value: 'Schools',
      // Until the school pages open (M11), a school leads to its instructor's profile.
      items: answer.schools
        .filter((hit) => hit.instructor)
        .map((hit) => ({ kind: 'school' as const, key: `school:${hit.id}`, label: hit.name, href: `/people/${hit.instructor!.slug}`, hit })),
    });
  }
  if (answer.lineages.length > 0) {
    groups.push({
      value: 'Lineages',
      items: answer.lineages.map((hit) => ({ kind: 'lineage' as const, key: `lineage:${hit.id}`, label: hit.name, href: `/people/${hit.root.slug}/lineage`, hit })),
    });
  }
  if (pages.length > 0) groups.push({ value: 'Pages', items: pages });
  return groups.filter((g) => g.items.length > 0);
}

function ItemBody({ item }: { item: Item }) {
  if (item.kind === 'recent') {
    return (
      <span className="flex min-w-0 items-center gap-3">
        <SearchIcon size={16} className="shrink-0 text-fg-subtle" />
        <span className="min-w-0 truncate" translate="no">
          {item.label}
        </span>
      </span>
    );
  }
  if (item.kind === 'page') {
    return (
      <span className="grid min-w-0 gap-0.5">
        <span className="text-ui font-semibold">{item.label}</span>
        <span className="text-sm text-fg-subtle" translate="no">
          {item.href}
        </span>
      </span>
    );
  }
  if (item.kind === 'person') {
    const { hit } = item;
    const where = [hit.city, countryName(hit.countryCode), hit.lineageName].filter(Boolean).join(' · ');
    return (
      <span className="grid min-w-0 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <Name name={hit.displayName} className="font-display text-lg leading-snug [overflow-wrap:anywhere]" />
          {hit.matched ? <Name name={hit.matched} className="text-ui text-fg-muted [overflow-wrap:anywhere]" /> : null}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 text-sm text-fg-subtle">
          {hit.verified ? (
            <span className="inline-flex items-center gap-1 font-semibold text-fg-muted">
              <Seal kind="check" size={14} />
              Verified
            </span>
          ) : null}
          {where ? <span className="[overflow-wrap:anywhere]">{where}</span> : null}
        </span>
      </span>
    );
  }
  if (item.kind === 'school') {
    const { hit } = item;
    return (
      <span className="grid min-w-0 gap-0.5">
        <span className="font-display text-lg leading-snug [overflow-wrap:anywhere]">{hit.name}</span>
        <span className="text-sm text-fg-subtle [overflow-wrap:anywhere]">
          {[hit.city, countryName(hit.countryCode)].filter(Boolean).join(', ')}
          {hit.instructor ? (
            <>
              {' · taught by '}
              <Name name={hit.instructor.displayName} />
            </>
          ) : null}
        </span>
      </span>
    );
  }
  const { hit } = item;
  return (
    <span className="grid min-w-0 gap-0.5">
      <span className="font-display text-lg leading-snug [overflow-wrap:anywhere]">{hit.name}</span>
      <span className="text-sm text-fg-subtle">
        Founded with <Name name={hit.root.displayName} />
      </span>
    </span>
  );
}

export interface SearchPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SearchPalette({ open, onOpenChange }: SearchPaletteProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  // The palette loads only in the browser, on first use: the history can be read at once.
  const [recent, setRecent] = useState<string[]>(readRecentSearches);
  // Every opening starts afresh: an empty field, and the history as storage has it now (cleared on
  // sign-out, or by another tab), never the last query and results kept in memory.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery('');
      setAnswer(null);
      setFailed(false);
      setRecent(readRecentSearches());
    }
  }
  const composing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const highlighted = useRef<Item | undefined>(undefined);
  // The trimmed query whose answer is on screen, and an Enter that waits for the next answer.
  const shownFor = useRef('');
  const opening = useRef<{ explore: boolean } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const hintId = useId();
  // The keyboard hints are shown (and describe the dialog) with the sheet; a phone has no such keys.
  const wide = useMediaQuery(SHEET_QUERY);
  const cancelPending = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    opening.current = null;
  };
  // Every way of closing comes here: a pending search is cancelled and its spinner cleared.
  const close = () => {
    cancelPending();
    shownFor.current = '';
    controller.current?.abort();
    setLoading(false);
    onOpenChange(false);
  };
  useBackToClose(open, close);

  // Nothing outlives the palette: a pending search is cancelled when it unmounts.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      controller.current?.abort();
    },
    [],
  );

  const run = async (q: string): Promise<SearchAnswer | null> => {
    // A search that runs now replaces any that waits for its pause.
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    controller.current?.abort();
    const trimmed = q.trim();
    if (!trimmed) {
      setAnswer(null);
      shownFor.current = '';
      setLoading(false);
      setFailed(false);
      return null;
    }
    const mine = new AbortController();
    controller.current = mine;
    setLoading(true);
    try {
      // The web's oRPC endpoint (plan §6.8; /api/v1 is the contract of the future mobile app), in
      // its wire format ({ json: input } → { json: output }). POST: the query (a name) never
      // travels in a URL (plan §6.4).
      const response = await fetch('/api/rpc/search/query', {
        method: 'POST',
        signal: mine.signal,
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ json: { q: trimmed } }),
      });
      if (!response.ok) throw new Error(`search ${response.status}`);
      const next = ((await response.json()) as { json: SearchAnswer }).json;
      if (mine.signal.aborted) return null;
      setAnswer(next);
      shownFor.current = trimmed;
      setFailed(false);
      return next;
    } catch {
      if (mine.signal.aborted) return null;
      setFailed(true);
      return null;
    } finally {
      if (!mine.signal.aborted) setLoading(false);
    }
  };

  const schedule = (q: string) => {
    // Typing again also drops an Enter that waited for the answer to the shorter query.
    cancelPending();
    // While an input method composes a name, nothing is sent (plan §5.6); compositionend searches.
    if (composing.current) return;
    timer.current = setTimeout(() => void run(q), SEARCH_DEBOUNCE_MS);
  };

  const remember = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const next = [trimmed, ...readRecentSearches().filter((r) => r !== trimmed)].slice(0, RECENT_SEARCHES_MAX);
    writeRecentSearches(next);
    setRecent(next);
  };

  const go = (href: string) => {
    remember(query);
    // The result takes the palette's history entry: Back from it returns to the page below.
    releaseLayerEntry();
    close();
    router.replace(href);
  };

  const choose = (item: Item, explore = false) => {
    if (item.kind === 'recent') {
      setQuery(item.label);
      void run(item.label);
      return;
    }
    go(explore && item.kind === 'person' ? item.explore : item.href);
  };

  const trimmed = query.trim();
  const groups: Group[] = trimmed
    ? groupsOf(answer, trimmed)
    : recent.length > 0
      ? [{ value: 'Recent searches', items: recent.map((r) => ({ kind: 'recent' as const, key: `recent:${r}`, label: r })) }]
      : [];
  const count = groups.reduce((n, g) => n + g.items.length, 0);
  const shown = `${count} ${count === 1 ? 'result' : 'results'}${loading ? ', updating…' : ''}`;
  const status = !trimmed
    ? ''
    : failed
      ? 'Search is not available right now.'
      : loading && !answer
        ? 'Searching…'
        : answer && count === 0
          ? `No public record matches “${trimmed}”.`
          : answer?.morePeople
            ? // The people list is cut at LIMITS.people: the count is not the whole number of matches.
              `${shown}. Only the first ${answer.people.length} people are shown: type more of the name to narrow the list.`
            : answer
              ? shown
              : '';

  const onKeyDownCapture = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || composing.current || event.key !== 'Enter') return;
    const explore = event.ctrlKey || event.metaKey;
    // Enter while the rows on screen still answer an earlier query (its pause or its request is
    // pending, or it failed): none of them opens. The search runs now and its first result opens,
    // unless the person types on or closes the palette first.
    if (trimmed && (timer.current !== null || loading || shownFor.current !== trimmed)) {
      event.preventDefault();
      event.stopPropagation();
      const wait = { explore };
      opening.current = wait;
      void run(query).then((fresh) => {
        if (!fresh || opening.current !== wait) return;
        opening.current = null;
        const first = groupsOf(fresh, trimmed)[0]?.items[0];
        if (first) choose(first, explore);
      });
      return;
    }
    // Ctrl/⌘+Enter: the highlighted person in the explorer (plan §5.6), before Autocomplete's own Enter.
    if (explore) {
      const item = highlighted.current;
      if (item && item.kind !== 'recent') {
        event.preventDefault();
        event.stopPropagation();
        choose(item, true);
      }
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim transition-opacity duration-(--duration-base) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Viewport className="fixed inset-0 z-50 flex items-stretch justify-center sheet:items-start sheet:px-4 sheet:pt-[max(4rem,env(safe-area-inset-top,0px))] sheet:pb-4">
          <Dialog.Popup
            data-testid="search-palette"
            aria-describedby={wide ? hintId : undefined}
            className={cx(
              'relative flex w-full flex-col bg-surface-2 text-fg outline-none [--seal-ground:var(--surface-2)]',
              // A phone: the whole screen (dvh), clear of the notch and the home indicator.
              'h-dvh pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]',
              // From 640 × 512 px (SHEET_QUERY): a sheet of paper under the top edge.
              'sheet:h-auto sheet:max-h-[min(40rem,calc(100dvh-6rem))] sheet:max-w-[40rem] sheet:rounded-lg sheet:border sheet:border-border-subtle sheet:p-0 sheet:shadow-pop',
              'transition-[opacity,transform] duration-(--duration-base) ease-out data-ending-style:opacity-0 data-starting-style:opacity-0 sheet:data-ending-style:-translate-y-2 sheet:data-starting-style:-translate-y-2',
            )}
          >
            <Dialog.Title className="sr-only">Search</Dialog.Title>
            <Autocomplete.Root
              open
              inline
              items={groups}
              filter={null}
              value={query}
              onValueChange={(value, details) => {
                // Choosing an item writes its label into the field; only typing searches.
                if (details.reason === 'item-press') return;
                // Esc closes the palette (its own Dialog), rather than only emptying the field.
                if (details.reason === 'escape-key') {
                  close();
                  return;
                }
                setQuery(value);
                schedule(value);
              }}
              itemToStringValue={(item: Item) => item.label}
              autoHighlight
              onItemHighlighted={(item) => {
                highlighted.current = item as Item | undefined;
              }}
            >
              <div
                onKeyDownCapture={onKeyDownCapture}
                // The input draws no outline of its own: the row's gold rule marks the focus (WCAG 2.4.7).
                className="flex items-center gap-1 border-b-2 border-border-subtle pr-1 pl-4 has-[input:focus-visible]:border-focus sheet:pr-2"
              >
                <SearchIcon size={20} className="shrink-0 text-fg-subtle" />
                <Autocomplete.Input
                  ref={input}
                  aria-label="Search people, schools and lineages"
                  placeholder="Any name, any script"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  enterKeyHint="search"
                  onCompositionStart={() => {
                    if (ANDROID) return;
                    composing.current = true;
                    cancelPending();
                  }}
                  onCompositionEnd={(event) => {
                    if (ANDROID) return;
                    composing.current = false;
                    const value = event.currentTarget.value;
                    setQuery(value);
                    schedule(value);
                  }}
                  className="min-h-14 min-w-0 flex-1 bg-transparent px-2 text-field text-fg outline-none placeholder:text-fg-subtle"
                />
                {loading ? (
                  <span aria-hidden="true" className="mr-1 size-4 shrink-0 animate-spin rounded-full border-2 border-fg-subtle border-r-transparent motion-reduce:animate-none" />
                ) : null}
                <Dialog.Close
                  aria-label="Close search"
                  className="inline-grid size-11 shrink-0 place-items-center rounded-sm text-fg-muted hover:bg-surface-3 hover:text-fg active:bg-surface-pressed"
                >
                  <CloseIcon size={20} />
                </Dialog.Close>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain sheet:flex-initial">
                <Autocomplete.Status className="block px-4 pt-3 text-sm text-fg-muted empty:hidden">{status}</Autocomplete.Status>
                {failed && trimmed ? (
                  <p className="px-4 pt-1">
                    <button type="button" onClick={() => void run(query)} className="link inline-flex min-h-11 items-center text-sm font-semibold">
                      Try again
                    </button>
                  </p>
                ) : null}
                {trimmed && answer && count === 0 && !loading && !failed ? (
                  <p className="px-4 pt-1 pb-4 text-sm text-fg-muted">
                    Only public profiles are searched. Names are spelled many ways: try the Chinese characters, Jyutping, pinyin, the Hong
                    Kong spelling or Cyrillic.
                  </p>
                ) : null}
                {!trimmed && recent.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-fg-muted">
                    Search by any spelling: <span translate="no">So Ching Laam</span>,{' '}
                    <span lang="zh-Hant" translate="no" className="cjk">
                      蘇晴嵐
                    </span>
                    , <span translate="no">sou cing laam</span> or <span translate="no">Su Qinglan</span> find the same person.
                  </p>
                ) : null}
                {!trimmed && recent.length > 0 ? (
                  // Clear sits outside the listbox: a button is no option, and it is no part of the group's name.
                  <p className="flex flex-wrap items-center justify-between gap-x-3 px-4 pt-2 text-sm text-fg-muted">
                    <span>Your last searches stay only in this browser and are cleared when you sign out.</span>
                    <button
                      type="button"
                      onClick={() => {
                        writeRecentSearches([]);
                        setRecent([]);
                        // The button goes with the list: the focus returns to the field.
                        input.current?.focus();
                      }}
                      className="link inline-flex min-h-11 min-w-11 items-center text-ui font-semibold"
                    >
                      Clear<span className="sr-only"> recent searches</span>
                    </button>
                  </p>
                ) : null}
                <Autocomplete.List className="pb-2">
                  {(group: Group) => (
                    <Autocomplete.Group key={group.value} items={group.items} className="pt-2">
                      <Autocomplete.GroupLabel className="flex min-h-9 items-center px-4 eyebrow">{group.value}</Autocomplete.GroupLabel>
                      <Autocomplete.Collection>
                        {(item: Item) => (
                          <Autocomplete.Item
                            key={item.key}
                            value={item}
                            // Base UI cancels the pointerdown on a result so that the field keeps the focus. For a touch,
                            // WebKit's GTK and WPE ports then count the whole tap as handled and send no click, so the
                            // result never opened there (the iPhone WebKit of CI). A touch keeps its pointerdown; the field
                            // keeps the focus all the same, as Base UI also cancels the mousedown that follows a tap.
                            onPointerDownCapture={(event) => {
                              if (event.pointerType === 'touch') event.preventBaseUIHandler();
                            }}
                            onClick={() => choose(item)}
                            data-kind={item.kind}
                            // The highlighted result is the keyboard's place (aria-activedescendant): a gold bar and frame
                            // as well as the tint, at least 3:1 in both themes (WCAG 1.4.11).
                            className="group mx-2 grid min-h-14 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-sm px-3 py-2 outline-none select-none data-highlighted:bg-surface-3 data-highlighted:shadow-[inset_3px_0_0_var(--focus),inset_0_0_0_1px_var(--focus)] active:bg-surface-pressed"
                          >
                            <ItemBody item={item} />
                            <ArrowRightIcon size={16} className="invisible text-fg-muted group-data-highlighted:visible" />
                          </Autocomplete.Item>
                        )}
                      </Autocomplete.Collection>
                    </Autocomplete.Group>
                  )}
                </Autocomplete.List>
              </div>

              <p id={hintId} className="hidden flex-wrap gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted sheet:flex">
                <span>
                  <kbd className="font-sans font-semibold">↑</kbd> <kbd className="font-sans font-semibold">↓</kbd> to move
                </span>
                <span>
                  <kbd className="font-sans font-semibold">Enter</kbd> to open
                </span>
                <span>
                  <kbd className="font-sans font-semibold">Ctrl</kbd>/<kbd className="font-sans font-semibold">⌘</kbd>+
                  <kbd className="font-sans font-semibold">Enter</kbd> to open a person in the explorer
                </span>
                <span>
                  <kbd className="font-sans font-semibold">Esc</kbd> to close
                </span>
              </p>
            </Autocomplete.Root>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
