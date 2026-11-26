// /explore (plan §4.1, §4.3; milestone M05): the interactive lineage explorer. The page reads the
// view's graph on the server through the same procedure the browser calls (lineage.ego or
// lineage.subtree), so the client island starts with its data, and, for view=list, renders the
// M04 list view of the person in focus. The graph itself is drawn by the client island
// (src/components/lineage/explorer), which loads React Flow and the ELK layout worker only here.
// Without a person in focus the page offers the public lineages as starting points.
//
// A read that fails is never shown as an empty record (plan §5.6): the starting points and the
// person in focus of the list view each have an error state with Retry, apart from "nothing here".
//
// The explorer fills the dynamic viewport height between the app shell's bars, inside the safe
// areas (plan §5.8 (b)).

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { NameText } from '@/components/account/person-names';
import { Explorer } from '@/components/lineage/explorer/explorer';
import { explorerHref, explorerRead, paramsFrom, readKey } from '@/components/lineage/explorer/state';
import { LineageName } from '@/components/lineage/person-name';
import { ErrorPanel, ProfileError } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ExploreStartDto } from '@/server/dto/explore';
import type { SearchResultDto } from '@/server/dto/search';
import type { LineageGraphDto } from '@/server/dto/public';
import LineageListPage from '../people/[slug]/lineage/page';
import { failure, lineageClient } from '../people/[slug]/data';
import { isAbsent, readFocus } from './data';

export const instant = false;

export const metadata: Metadata = {
  title: 'Explorer',
  robots: { index: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The list view's own keys, as its links write them (M04): the students page and "all routes". */
function listKeys(page: number, routesAll: boolean): Record<string, string> {
  return { ...(page > 1 ? { page: String(page) } : {}), ...(routesAll ? { routes: 'all' } : {}) };
}

/** The list view's keys from the address, for Retry (the M04 list validates them again when it renders). */
function listKeysOf(query: Record<string, string | string[] | undefined>): Record<string, string> {
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const page = one(query.page);
  return listKeys(page && /^\d{1,4}$/.test(page) ? Number(page) : 1, one(query.routes) === 'all');
}

/**
 * The explorer's frame: the dynamic viewport between the shell's top bar and its tab bar (phones),
 * the whole height beside the rail (desktop). The top bar is --top-h tall with its 1 px bottom
 * border below that, so the page is exactly the viewport's height and does not scroll.
 */
const FRAME = 'h-[calc(100dvh-var(--top-h)-1px-env(safe-area-inset-top,0px)-var(--page-clear-bottom))] md:h-dvh';

/** The answer of the explorer's search: people open the explorer around them, lineages at their root. */
function SearchResults({ q, result, starts }: { q: string; result: SearchResultDto | null; starts: ExploreStartDto['lineages'] }) {
  if (!result) {
    return (
      <p role="status" className="mt-4 text-sm text-fg-muted" data-testid="explore-search-results" data-state="failed">
        The search could not be run just now. Nothing was changed: try again in a moment.
      </p>
    );
  }
  const people = result.people.slice(0, 10);
  const rootOf = new Map(starts.map((l) => [l.id, l.root.id]));
  if (people.length === 0 && result.lineages.length === 0) {
    return (
      <p role="status" className="mt-4 text-sm text-fg-muted" data-testid="explore-search-results" data-state="none">
        Nobody and no lineage on the public record matches “{q}”. Try another spelling.
      </p>
    );
  }
  return (
    <section aria-labelledby="explore-results" className="mt-6" data-testid="explore-search-results" data-state="shown">
      <h2 id="explore-results" className="font-display text-xl">
        Found for “{q}”
      </h2>
      <ul className="mt-2 grid border-t border-border-subtle">
        {result.lineages.map((l) => {
          const root = rootOf.get(l.id);
          return (
            <li key={`l-${l.id}`} className="border-b border-border-subtle" data-testid="explore-result" data-kind="lineage">
              <Link
                href={root ? `/explore?focus=${root}&lineage=${l.id}` : `/people/${l.root.slug}/lineage`}
                prefetch={false}
                className="flex min-h-12 flex-wrap items-baseline gap-x-2 py-2 hover:underline"
              >
                <span className="font-display text-lg">
                  <LineageName name={l.name} />
                </span>
                <span className="text-sm text-fg-muted">
                  Lineage · root <NameText name={l.root.displayName} />
                </span>
              </Link>
            </li>
          );
        })}
        {people.map((p) => (
          <li key={`p-${p.id}`} className="border-b border-border-subtle" data-testid="explore-result" data-kind="person">
            <Link href={`/explore?focus=${p.id}`} prefetch={false} className="flex min-h-12 flex-wrap items-baseline gap-x-2 py-2 hover:underline">
              <span className="font-display text-lg">
                <NameText name={p.displayName} />
              </span>
              {p.matched ? (
                <span className="text-sm text-fg-muted">
                  <NameText name={p.matched} />
                </span>
              ) : null}
              {p.lineageName ? (
                <span className="text-sm text-fg-muted">
                  <LineageName name={p.lineageName} />
                </span>
              ) : null}
              {p.city ? <span className="text-sm text-fg-muted">{p.city}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
      {result.morePeople || result.people.length > people.length ? (
        <p className="mt-2 text-sm text-fg-muted">More people match: add more of the name to narrow it down.</p>
      ) : null}
    </section>
  );
}

export default async function ExplorePage({ searchParams }: Props) {
  const query = await searchParams;
  const params = paramsFrom(query);
  const client = await lineageClient();
  let starts: ExploreStartDto | null = null;
  try {
    starts = await client.lineage.start();
  } catch (error) {
    console.error(`[explore] the starting points could not be loaded: ${failure(error)}`);
  }

  if (!params.focus) {
    const raw = Array.isArray(query.q) ? query.q[0] : query.q;
    const q = (raw ?? '').trim().slice(0, 100);
    let found: SearchResultDto | null = null;
    if (q) {
      try {
        found = await client.search.query({ q });
      } catch (error) {
        console.error(`[explore] the search could not be run: ${failure(error)}`);
      }
    }
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]">
          <p className="eyebrow">Explorer</p>
          <h1 className="mt-2 font-display text-feature">Explore a lineage</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            The explorer draws who taught whom, generation by generation, around one person or a whole lineage. Start from a lineage
            below, or from anyone&apos;s profile.
          </p>
          {/* Search first (role replay 2026-11-25, P3-6): a plain form, no script, that finds a person
              by any spelling and a lineage by its name through search.query, and opens the explorer there. */}
          <form action="/explore" method="get" role="search" aria-label="Search the lineages" className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-2" data-testid="explore-search">
            <label htmlFor="explore-q" className="text-sm font-semibold">
              A person or a lineage
            </label>
            <div className="flex flex-wrap gap-3">
              <input
                id="explore-q"
                name="q"
                type="search"
                defaultValue={q}
                maxLength={100}
                autoComplete="off"
                className="min-h-12 min-w-0 flex-1 basis-56 rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg hover:border-fg-muted focus-visible:border-fg"
              />
              <button type="submit" className={buttonVariants({ variant: 'primary' })}>
                Search
              </button>
            </div>
            <p className="text-sm text-fg-subtle">Any spelling of a name: Latin letters, Chinese characters, Cyrillic, Jyutping or pinyin.</p>
          </form>
          {q ? <SearchResults q={q} result={found} starts={starts?.lineages ?? []} /> : null}
          {starts === null ? (
            // A failed read is not an empty record: it says so, with Retry (a plain reload).
            <ErrorPanel title="The lineages could not be loaded." className="mt-8">
              <p className="max-w-[56ch] text-sm text-fg-muted">Nothing was changed. This is usually brief: try again in a moment.</p>
              <a href={explorerHref(params)} className={buttonVariants({ variant: 'secondary' })}>
                Retry
              </a>
            </ErrorPanel>
          ) : starts.lineages.length === 0 ? (
            <div className="mt-8 grid gap-1 border-t border-border-subtle pt-5" data-testid="explore-empty">
              <p className="text-ui text-fg-muted">No lineage with a public root is on the record yet.</p>
              <p className="text-sm text-fg-muted">
                A lineage grows from confirmed links between teachers and students.{' '}
                <Link href="/dashboard/teachers/new" prefetch={false} className="link inline-flex min-h-11 items-center">
                  Name your teacher
                </Link>
              </p>
            </div>
          ) : (
            // Role replay 2026-11-25, P3-6: cards with the root and the size, two to a row from 640 px.
            <section aria-labelledby="explore-lineages" className="mt-8">
              <h2 id="explore-lineages" className="font-display text-xl">
                Lineages on the record
              </h2>
              <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                {starts.lineages.map((l) => (
                  <li key={l.id} className="grid content-between gap-4 rounded-sm border border-border-subtle bg-surface-1 p-4" data-testid="explore-lineage">
                    <div className="grid min-w-0 gap-1">
                      <h3 className="font-display text-xl [overflow-wrap:anywhere]">
                        <LineageName name={l.name} />
                      </h3>
                      <p className="text-sm text-fg-muted">
                        Root:{' '}
                        <Link href={`/people/${l.root.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center">
                          <span lang="und-Latn" translate="no">
                            {l.root.displayName}
                          </span>
                        </Link>
                      </p>
                      <p className="flex items-baseline gap-1.5" data-testid="explore-lineage-size">
                        <span className="font-display text-2xl tabular">{l.people.toLocaleString('en')}</span>{' '}
                        <span className="text-sm text-fg-muted">{l.people === 1 ? 'person on the public record' : 'people on the public record'}</span>
                      </p>
                    </div>
                    <Link href={`/explore?focus=${l.root.id}&lineage=${l.id}`} className={buttonVariants({ variant: 'secondary', className: 'justify-self-start' })}>
                      {/* One flex item, so the space after "Explore" stays a space. */}
                      <span>
                        Explore <LineageName name={l.name} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    );
  }

  const focusId = params.focus;
  // With a person in focus the graph does not need the starting points: without them the Lineage
  // view starts at the focus, as for a lineage whose root is unknown (DEFAULT D22).
  const lineages = starts?.lineages ?? [];
  const lineageRoot = lineages.find((l) => l.id === params.lineage)?.root.id ?? null;
  // The server cannot know the screen's width: it reads the desktop defaults (plan §4.3), and a
  // phone asks for its smaller view itself.
  const read = explorerRead({ ...params, focus: focusId }, lineageRoot, false);
  let graph: LineageGraphDto | null = null;
  try {
    graph = read.procedure === 'ego' ? await client.lineage.ego(read.input) : await client.lineage.subtree(read.input);
  } catch (error) {
    if (!isAbsent(error)) console.error(`[explore] the lineage could not be loaded: ${failure(error)}`);
  }
  let list: React.ReactNode = null;
  if (params.view === 'list') {
    // The focus may be outside the graph (the lineage view starts at the root, three generations
    // deep) or the graph read may have failed: the list view then asks for the person alone.
    const inGraph = graph?.nodes.find((n) => n.id === focusId)?.slug;
    const focus = inGraph ? ({ state: 'found', slug: inGraph } as const) : await readFocus(() => client.lineage.ego({ focusId, up: 0, down: 0 }), focusId);
    if (focus.state === 'failed') console.error(`[explore] the person in focus could not be loaded: ${failure(focus.error)}`);
    list =
      focus.state === 'found' ? (
        // The M04 list view inside the explorer: its pages and "all routes" stay here (screens review).
        <LineageListPage
          params={Promise.resolve({ slug: focus.slug })}
          searchParams={Promise.resolve({ page: query.page, routes: query.routes })}
          embed={{ href: (page, routesAll) => explorerHref(params, listKeys(page, routesAll)) }}
        />
      ) : focus.state === 'failed' ? (
        // Retry opens the same view again (M04's ProfileError: a plain reload).
        <ProfileError retryHref={explorerHref(params, listKeysOf(query))} />
      ) : (
        <p role="status" className="p-6 text-ui text-fg-muted">
          There is no public profile with this address in the record.
        </p>
      );
  }

  return (
    <div className={FRAME}>
      <Suspense fallback={null}>
        <Explorer initial={graph ? { key: readKey(read), graph } : null} starts={lineages} list={list} />
      </Suspense>
    </div>
  );
}
