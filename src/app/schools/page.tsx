// /schools (milestone M11, In scope 6; plan §5.3, §5.6, §5.8): the school finder. A plain GET form
// (a city or town, a radius, a lineage) and the state in the address (src/lib/school-finder.ts),
// read on the server through the same procedures the browser and the mobile app call
// (schools.search, places.search, lineage.start), so the list is in the first HTML and works
// without JavaScript.
//
// - view=map (the default): the map island (src/components/schools/finder.tsx) fills the dynamic
//   viewport between the shell's bars, inside the safe areas (the explorer's frame), with the list
//   beside it from 1024 px and in a bottom sheet below. MapLibre loads only here, after the page.
// - view=list: the same schools as a list, in the page's flow.
//
// "Near" looks the place up in the GeoNames extract (no geocoding service); a place that is not
// there says so and shows every school. A read that fails shows an error state with Retry, never
// an empty finder (plan §5.6).

import type { Metadata } from 'next';
import Link from 'next/link';

import { ErrorPanel } from '@/components/lineage/states';
import { ChevronDownIcon, SearchIcon } from '@/components/icons';
import { Finder } from '@/components/schools/finder';
import { SchoolList, summaryText } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { circleBounds, DEFAULT_RADIUS_KM, finderHref, finderParams, type FinderParams, RADIUS_CHOICES_KM, searchCenterOf } from '@/lib/school-finder';
import type { PlaceSearchDto, SchoolSearchDto } from '@/server/dto/schools';
import { mapStyles } from '@/server/geo/map-styles';
import { failure, lineageClient } from '../people/[slug]/data';

export const instant = false;

export const metadata: Metadata = {
  title: 'Schools',
  description: 'Find a Wing Chun school on the map or in a list, by city, distance and lineage.',
  alternates: { canonical: '/schools' },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * The finder's frame: the dynamic viewport between the shell's top bar and its tab bar (phones),
 * the whole height beside the rail (desktop), as the explorer's (src/app/explore/page.tsx).
 */
const FRAME = 'h-[calc(100dvh-var(--top-h)-1px-env(safe-area-inset-top,0px)-var(--page-clear-bottom))] md:h-dvh';

const fieldClass = 'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg hover:border-fg-muted focus-visible:border-fg';
const selectClass = `${fieldClass} appearance-none pr-11`;

interface LineageOption {
  rootId: string;
  label: string;
}

/** One option per lineage root: the lineages it heads, by name. */
function lineageOptions(lineages: { name: string; root: { id: string } }[]): LineageOption[] {
  const byRoot = new Map<string, string[]>();
  for (const l of lineages) byRoot.set(l.root.id, [...(byRoot.get(l.root.id) ?? []), l.name]);
  return [...byRoot].map(([rootId, names]) => ({ rootId, label: names.join(' / ') })).sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

function Filters({ params, lineages, compact }: { params: FinderParams; lineages: LineageOption[]; compact: boolean }) {
  // Below 1024 px in the map view the select labels are for screen readers only (their options say
  // "Within 50 km" and "All lineages"): the map keeps its room. The place field keeps its label.
  const selectLabel = compact ? 'max-lg:sr-only' : '';
  return (
    <form method="get" action="/schools" role="search" aria-label="Find a school" className="grid grid-cols-2 items-end gap-x-3 gap-y-2 lg:flex lg:flex-wrap">
      {params.view === 'list' ? <input type="hidden" name="view" value="list" /> : null}
      <div className="col-span-2 grid gap-1.5 lg:w-72">
        <label htmlFor="school-near" className="text-sm font-semibold">
          Near
        </label>
        <div className="flex gap-2">
          <input
            id="school-near"
            name="near"
            type="search"
            defaultValue={params.near ?? ''}
            placeholder="City or town"
            autoComplete="address-level2"
            maxLength={100}
            enterKeyHint="search"
            className={fieldClass}
          />
          <button type="submit" className={cx(buttonVariants({ variant: 'primary' }), 'min-h-12 shrink-0 lg:hidden')}>
            <SearchIcon size={18} />
            <span className="sr-only">Search</span>
          </button>
        </div>
      </div>
      <div className="grid gap-1.5 lg:w-44">
        <label htmlFor="school-radius" className={cx('text-sm font-semibold', selectLabel)}>
          Distance
        </label>
        <div className="relative">
          <select id="school-radius" name="radius" defaultValue={String(params.radius ?? DEFAULT_RADIUS_KM)} className={selectClass}>
            {RADIUS_CHOICES_KM.map((km) => (
              <option key={km} value={km}>
                Within {km} km
              </option>
            ))}
            {params.radius !== null && !(RADIUS_CHOICES_KM as readonly number[]).includes(params.radius) ? <option value={params.radius}>Within {params.radius} km</option> : null}
          </select>
          <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
        </div>
      </div>
      <div className="grid gap-1.5 lg:w-64">
        <label htmlFor="school-lineage" className={cx('text-sm font-semibold', selectLabel)}>
          Lineage
        </label>
        <div className="relative">
          <select id="school-lineage" name="lineage" defaultValue={params.lineage ?? ''} className={selectClass}>
            <option value="">All lineages</option>
            {lineages.map((l) => (
              <option key={l.rootId} value={l.rootId}>
                {l.label}
              </option>
            ))}
          </select>
          <ChevronDownIcon size={20} className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-fg-muted" />
        </div>
      </div>
      <button type="submit" className={cx(buttonVariants({ variant: 'primary' }), 'min-h-12 max-lg:hidden')}>
        <SearchIcon size={18} />
        Search
      </button>
    </form>
  );
}

function ViewSwitch({ params }: { params: FinderParams }) {
  const item = (view: 'map' | 'list', label: string) => {
    const current = params.view === view;
    return (
      <Link
        href={finderHref({ ...params, view })}
        aria-current={current ? 'page' : undefined}
        className={cx(
          'inline-flex min-h-11 min-w-16 items-center justify-center px-4 text-sm font-semibold',
          // The current view: ink fill and a check-free bold label, never colour alone (aria-current says it too).
          current ? 'bg-fg text-fg-inverse' : 'text-fg hover:bg-surface-3',
        )}
        data-testid={`view-${view}`}
      >
        {label}
      </Link>
    );
  };
  return (
    <nav aria-label="View" className="inline-flex overflow-hidden rounded-sm border border-border-strong">
      {item('map', 'Map')}
      {item('list', 'List')}
    </nav>
  );
}

export default async function SchoolsPage({ searchParams }: Props) {
  const params = finderParams(await searchParams);
  const client = await lineageClient();

  let lineages: LineageOption[] = [];
  try {
    lineages = lineageOptions((await client.lineage.start()).lineages);
  } catch (error) {
    console.error(`[schools] the lineages could not be loaded: ${failure(error)}`);
  }

  // The centre: the place named in "near", else lat and lng with a radius.
  let near: PlaceSearchDto['places'][number] | null = null;
  let nearMissing = false;
  if (params.near) {
    try {
      near = (await client.places.search({ q: params.near })).places[0] ?? null;
      nearMissing = near === null;
    } catch (error) {
      console.error(`[schools] the place could not be looked up: ${failure(error)}`);
      nearMissing = true;
    }
  }
  const center = near ? near.point : params.near ? null : searchCenterOf(params);
  const radiusKm = center ? (params.radius ?? DEFAULT_RADIUS_KM) : null;

  let result: SchoolSearchDto | null = null;
  try {
    result = await client.schools.search({ center, radiusKm: radiusKm ?? undefined, lineageRootId: params.lineage });
  } catch (error) {
    console.error(`[schools] the schools could not be loaded: ${failure(error)}`);
  }
  const lineageLabel = params.lineage ? (lineages.find((l) => l.rootId === params.lineage)?.label ?? result?.lineage?.rootName ?? null) : null;
  const summary = result ? summaryText(result.total, radiusKm, near ? near.name : null, lineageLabel) : '';
  const listHref = finderHref({ ...params, view: 'list' });

  const notice = nearMissing ? (
    <p role="status" className="mt-3 text-sm" data-testid="near-missing">
      No city or town called “{params.near}” is in the place list, so every school is shown. Try another spelling, or a larger city nearby.
    </p>
  ) : null;
  const failed = (
    <ErrorPanel title="The schools could not be loaded." className="mx-page my-6 lg:mx-6">
      <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
      <Link href={finderHref(params)} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
        Try again
      </Link>
    </ErrorPanel>
  );

  if (params.view === 'list') {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <header className="grid gap-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="eyebrow">Schools</p>
              <h1 className="mt-2 font-display text-feature">Find a school</h1>
            </div>
            <ViewSwitch params={params} />
          </div>
          <Filters params={params} lineages={lineages} compact={false} />
          {notice}
        </header>
        {result ? (
          <section aria-labelledby="school-list-heading" className="mt-8 max-w-[46rem]">
            <h2 id="school-list-heading" className="text-sm font-semibold" data-testid="school-summary">
              {summary}
            </h2>
            {result.schools.length > 0 ? (
              <SchoolList schools={result.schools} className="mt-2" />
            ) : (
              <p className="py-4 text-fg-muted" data-testid="school-empty">
                No public school matches this search. Try a larger radius, another place or all lineages.
              </p>
            )}
          </section>
        ) : (
          failed
        )}
      </div>
    );
  }

  const initialView = params.lat !== null && params.lng !== null ? { lat: params.lat, lng: params.lng, zoom: params.z ?? 10 } : null;
  return (
    <div className={cx(FRAME, 'flex flex-col')}>
      <header className="shrink-0 border-b border-border-subtle px-page pt-3 pb-3 lg:px-6">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h1 className="font-display text-xl leading-tight lg:text-2xl">Find a school</h1>
          <ViewSwitch params={params} />
        </div>
        <Filters params={params} lineages={lineages} compact />
        {notice}
      </header>
      {result ? (
        <Finder
          schools={result.schools}
          summary={summary}
          styles={mapStyles()}
          initial={{ view: initialView, bounds: center && radiusKm ? circleBounds(center, radiusKm) : null }}
          search={{ center, radiusKm, lineage: params.lineage }}
          listHref={listHref}
        />
      ) : (
        failed
      )}
    </div>
  );
}
