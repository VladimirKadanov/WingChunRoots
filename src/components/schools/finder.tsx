'use client';

// The school finder's map view (milestone M11, In scope 6; plan §5.3, §5.6, §5.8): the client
// island of /schools. The page reads the schools on the server (schools.search) and hands them
// here with the summary line; the island adds the map, the selection and the address of the view.
//
// - The map (src/components/map/school-map.tsx, MapLibre) loads with next/dynamic, so its code and
//   its style load only on /schools, after the page. Without WebGL 2 (or when the map fails to
//   start) the island shows the same schools as a list, with a note saying why.
// - From 1024 px: the list beside the map (an aside that scrolls on its own); a selected pin marks
//   its row and scrolls it into view.
// - Below 1024 px: the map fills the frame, and the list lives in a non-modal bottom sheet (the
//   Drawer, snap points 0.15, 0.5 and 0.92) titled with the summary ("23 schools within 50 km ·
//   Demo Lineage A"). Selecting a pin opens the sheet with that school under the title, and the
//   map's bottom padding follows the sheet's height (the Drawer's --sheet-page-cover, which counts
//   the tab bar and the home indicator's safe area), so the pin stays visible above the sheet. The
//   sheet covers the map rather than shrinking it (coverAbove): the map keeps its size.
// - The address: the view (lat, lng, z) is written with replaceState when the map stops moving,
//   at most every VIEW_WRITE_MS (src/lib/school-finder.ts). "Search this area" appears when the
//   view has left the search, and searches around the centre of the view.

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';

import type { Bounds, MapView } from '@/components/map/school-map';
import { SearchIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import type { DrawerActions } from '@/components/ui/drawer';
import { useMediaQuery } from '@/components/ui/use-media-query';
import { cx } from '@/lib/cx';
import { DEFAULT_RADIUS_KM, distanceKm, finderHref, VIEW_WRITE_MS, withView } from '@/lib/school-finder';
import type { GeoPointDto, SchoolPinDto } from '@/server/dto/schools';
import { locationText, SchoolList } from './school-list';

const SchoolMap = dynamic(() => import('@/components/map/school-map'), {
  ssr: false,
  loading: () => <div className="size-full animate-pulse bg-surface-1 motion-reduce:animate-none" data-testid="school-map-loading" />,
});
const Drawer = dynamic(() => import('@/components/ui/drawer').then((m) => m.Drawer), { ssr: false });

/** The sheet's snap points (plan M11, In scope 6). */
const SNAP_POINTS = [0.15, 0.5, 0.92];
/** The sheet always covers the map (it publishes --sheet-page-cover, never shrinks the page). */
const COVER_ALWAYS = Number.MAX_SAFE_INTEGER;
/** The list beside the map from here (the Drawer's side-panel width). */
const WIDE = '(min-width: 64rem)';
/**
 * Below this much map above the sheet (two 44 px touch targets), the map is out of reach (inert)
 * until the sheet comes down. A phone's half-open sheet leaves about 120 px of map, which stays usable.
 */
const MAP_MIN_VISIBLE = 88;

export interface FinderProps {
  schools: SchoolPinDto[];
  /** "23 schools within 50 km · Demo Lineage A". */
  summary: string;
  styles: { light: string; dark: string };
  initial: { view: MapView | null; bounds: Bounds | null };
  /** The search the page answered: its centre and radius, and the lineage filter (a root id). */
  search: { center: GeoPointDto | null; radiusKm: number | null; lineage: string | null };
  /** The same search as a list (the address with view=list). */
  listHref: string;
}

// --- WebGL 2 ---------------------------------------------------------------------------------

let webgl2: boolean | undefined;
/** Whether this browser can give the map a WebGL 2 context (asked once; the probe's context is released). */
function webgl2Available(): boolean {
  if (webgl2 === undefined) {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      webgl2 = !!gl;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      webgl2 = false;
    }
  }
  return webgl2;
}
const subscribeNever = () => () => {};

// --- The sheet over the map --------------------------------------------------------------------

function subscribeSheet(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', onChange);
  return () => {
    observer.disconnect();
    window.removeEventListener('resize', onChange);
  };
}

/** How far a covering sheet reaches up over `frame`, in px (the Drawer's --sheet-page-cover, from the window's bottom). */
function sheetOver(frame: HTMLElement | null): number {
  if (!frame) return 0;
  const cover = Number.parseFloat(document.documentElement.style.getPropertyValue('--sheet-page-cover'));
  if (!Number.isFinite(cover) || cover <= 0) return 0;
  const below = window.innerHeight - frame.getBoundingClientRect().bottom;
  return Math.max(0, Math.round(cover - below));
}

function frameHeight(frame: HTMLElement | null): number {
  return frame ? Math.round(frame.getBoundingClientRect().height) : 0;
}

// --- The address -------------------------------------------------------------------------------

/** The address without the view keys, to tell a sheet's Back (same search) from a step to another search. */
function searchKey(href: string): string {
  const url = new URL(href, 'http://finder.invalid');
  for (const key of ['lat', 'lng', 'z']) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.search;
}

/** replaceState with the history entry's own keys (a sheet's history layer), so Next.js keeps its router state. */
function replaceAddress(href: string) {
  const state = (window.history.state ?? {}) as Record<string, unknown>;
  const own = Object.fromEntries(Object.entries(state).filter(([key]) => key !== '__NA' && key !== '__PRIVATE_NEXTJS_INTERNALS_TREE'));
  window.history.replaceState(own, '', href);
}

export function Finder({ schools, summary, styles, initial, search, listHref }: FinderProps) {
  const router = useRouter();
  const wide = useMediaQuery(WIDE);
  const canDraw = useSyncExternalStore(subscribeNever, webgl2Available, () => true);
  const [failed, setFailed] = useState(false);
  const mapShown = canDraw && !failed;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = schools.find((s) => s.id === selectedId) ?? null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheet = useRef<DrawerActions>(null);
  const showList = useRef<HTMLButtonElement>(null);
  /** The focus was in the sheet when it closed (read then: the closing sheet's body turns inert). */
  const focusWasInSheet = useRef(false);
  const aside = useRef<HTMLDivElement>(null);

  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const phoneSheet = !wide && sheetOpen && mapShown;
  const over = useSyncExternalStore(subscribeSheet, () => (phoneSheet ? sheetOver(frame) : 0), () => 0);
  const height = useSyncExternalStore(subscribeSheet, () => frameHeight(frame), () => 0);
  const mapCovered = phoneSheet && height > 0 && height - over < MAP_MIN_VISIBLE;

  // The view, as the map last reported it, and its trailing write into the address.
  const [view, setView] = useState<MapView | null>(initial.view);
  const [userMoved, setUserMoved] = useState(false);
  const lastWrite = useRef(0);
  const pending = useRef<number | null>(null);
  /** The address as this island last left it (a write, or the page of a new search). */
  const address = useRef('');
  const writeView = (next: MapView) => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    const wait = Math.max(0, VIEW_WRITE_MS - (Date.now() - lastWrite.current));
    pending.current = window.setTimeout(() => {
      pending.current = null;
      lastWrite.current = Date.now();
      const href = withView(`${window.location.pathname}${window.location.search}`, next, search.center !== null);
      replaceAddress(href);
      address.current = window.location.href;
    }, wait);
  };
  // Each search (a new page from the server) starts from its own address.
  useEffect(() => {
    address.current = window.location.href;
  }, [listHref]);
  // A sheet closed by a button steps back over its history entry, to the address from before the
  // view moved: the view is written again. A step back to another search keeps that search's address.
  const rewriteView = useEffectEvent(() => {
    const same = searchKey(address.current || window.location.href) === searchKey(window.location.href);
    address.current = window.location.href;
    if (same && view) writeView(view);
  });
  useEffect(() => {
    const onPopState = () => rewriteView();
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      if (pending.current !== null) window.clearTimeout(pending.current);
    };
  }, []);

  const select = (id: string) => {
    setSelectedId(id);
    if (!wide) setSheetOpen(true);
  };

  // From 1024 px the selected row scrolls into view in the list beside the map.
  useEffect(() => {
    if (!wide || !selectedId) return;
    const row = aside.current?.querySelector<HTMLElement>(`[data-testid="school-row"][data-id="${selectedId}"]`);
    row?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [wide, selectedId]);

  // "Search this area": the view's centre has left the search (a third of its radius), or there is no search yet.
  const radius = search.radiusKm ?? DEFAULT_RADIUS_KM;
  const moved = userMoved && view !== null && (search.center === null || distanceKm(search.center, view) > radius / 3);
  const searchArea = () => {
    if (!view) return;
    router.push(finderHref({ lat: view.lat, lng: view.lng, z: view.zoom, radius, lineage: search.lineage, view: 'map' }));
  };

  const empty = (
    <p className="py-4 text-fg-muted" data-testid="school-empty">
      No public school matches this search. Try a larger radius, another place or all lineages.
    </p>
  );

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,26rem)_1fr]" data-testid="school-finder" data-map={mapShown ? 'shown' : 'fallback'}>
      {/* From 1024 px: the list beside the map. */}
      <aside ref={aside} aria-labelledby="school-list-heading" className="min-h-0 overflow-y-auto overscroll-contain border-r border-border-subtle px-page pb-6 max-lg:hidden lg:px-6">
        <h2 id="school-list-heading" className="sticky top-0 z-10 bg-bg py-3 text-sm font-semibold" data-testid="school-summary">
          {summary}
        </h2>
        {schools.length > 0 ? <SchoolList schools={schools} selectedId={selectedId} onShow={mapShown ? (id) => setSelectedId(id) : undefined} /> : empty}
      </aside>

      <div ref={setFrame} className="relative min-h-0" data-testid="school-map-frame">
        {mapShown ? (
          <div className="size-full" inert={mapCovered || undefined}>
            <SchoolMap
              schools={schools}
              selectedId={selectedId}
              onSelect={select}
              styles={styles}
              initial={initial}
              paddingBottom={over}
              onViewChange={(next, byUser) => {
                setView(next);
                if (byUser) setUserMoved(true);
                // The first fit to the schools is no view of the reader's: the address keeps none.
                if (byUser || userMoved || selectedId) writeView(next);
              }}
              onFail={() => setFailed(true)}
            />
            {moved ? (
              <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center px-16">
                <button type="button" onClick={searchArea} className={cx(buttonVariants({ variant: 'ink', size: 'sm' }), 'pointer-events-auto shadow-sheet')} data-testid="search-area">
                  <SearchIcon size={16} />
                  Search this area
                </button>
              </div>
            ) : null}
            {/* Below 1024 px with the sheet closed: the summary, which opens the list. */}
            <div className={cx('pointer-events-none absolute inset-x-0 bottom-3 justify-center px-3 lg:hidden', sheetOpen ? 'hidden' : 'flex')}>
              <button
                ref={showList}
                type="button"
                onClick={() => setSheetOpen(true)}
                className="pointer-events-auto flex min-h-11 max-w-full items-center gap-2 rounded-sheet border border-border-strong bg-surface-2 px-4 py-2 text-left text-sm font-semibold shadow-sheet"
                data-testid="show-list"
              >
                <span className="[overflow-wrap:anywhere]">{summary}</span>
                <span className="shrink-0 text-fg-muted underline underline-offset-2">Show the list</span>
              </button>
            </div>
          </div>
        ) : (
          // No WebGL 2, or the map could not start: the same schools as a list.
          <div className="size-full overflow-y-auto overscroll-contain px-page pb-6" data-testid="map-fallback">
            <p role="status" className="mt-4 rounded-sm border border-border-strong bg-surface-1 p-3 text-sm">
              This browser cannot draw the map (it needs WebGL 2), so the same schools are listed here.{' '}
              <Link href={listHref} className="link">
                Open the list view
              </Link>
            </p>
            <h2 className="mt-4 text-sm font-semibold lg:hidden">{summary}</h2>
            <div className="lg:hidden">{schools.length > 0 ? <SchoolList schools={schools} /> : empty}</div>
          </div>
        )}
      </div>

      {!wide && mapShown ? (
        <Drawer
          open={sheetOpen}
          onOpenChange={(next) => {
            if (!next) {
              focusWasInSheet.current = !!document.activeElement?.closest('[data-school-sheet]');
              setSelectedId(null);
            }
            setSheetOpen(next);
          }}
          title={summary}
          description={selected ? `${selected.name} · ${locationText(selected)}` : 'Drag up or choose Expand for the list.'}
          snapPoints={SNAP_POINTS}
          modal={false}
          initialFocus={false}
          // Focus that was in the sheet goes to the button that opens it again.
          finalFocus={() => (focusWasInSheet.current ? (showList.current ?? false) : false)}
          coverAbove={COVER_ALWAYS}
          actions={sheet}
          popupAttributes={{ 'data-testid': 'school-sheet', 'data-school-sheet': '' }}
          headerActions={
            selected ? (
              <Link href={`/schools/${selected.slug}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })} data-testid="sheet-school-link">
                Open the school page
              </Link>
            ) : null
          }
        >
          {schools.length > 0 ? (
            <SchoolList
              schools={schools}
              selectedId={selectedId}
              onShow={(id) => {
                setSelectedId(id);
                // Down to the peek, so the map shows the school.
                sheet.current?.collapse();
              }}
            />
          ) : (
            empty
          )}
        </Drawer>
      ) : null}
    </div>
  );
}
