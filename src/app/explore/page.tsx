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

import { Explorer } from '@/components/lineage/explorer/explorer';
import { explorerHref, explorerRead, paramsFrom, readKey } from '@/components/lineage/explorer/state';
import { LineageName } from '@/components/lineage/person-name';
import { ErrorPanel, ProfileError } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ExploreStartDto } from '@/server/dto/explore';
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

/** The explorer's frame: the dynamic viewport between the shell's top bar and its tab bar (phones), the whole height beside the rail (desktop). */
const FRAME = 'h-[calc(100dvh-var(--top-h)-env(safe-area-inset-top,0px)-var(--page-clear-bottom))] md:h-dvh';

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
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]">
          <p className="eyebrow">Explorer</p>
          <h1 className="mt-2 font-display text-feature">Explore a lineage</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">
            The explorer draws who taught whom, generation by generation, around one person or a whole lineage. Start from a lineage
            below, or from anyone&apos;s profile.
          </p>
          {starts === null ? (
            // A failed read is not an empty record: it says so, with Retry (a plain reload).
            <ErrorPanel title="The lineages could not be loaded." className="mt-8">
              <p className="max-w-[56ch] text-sm text-fg-muted">Nothing was changed. This is usually brief: try again in a moment.</p>
              <a href={explorerHref(params)} className={buttonVariants({ variant: 'secondary' })}>
                Retry
              </a>
            </ErrorPanel>
          ) : starts.lineages.length === 0 ? (
            <p className="mt-8 border-t border-border-subtle pt-5 text-ui text-fg-muted">No lineage with a public root is on the record yet.</p>
          ) : (
            <ul className="mt-8 grid border-t border-border-subtle">
              {starts.lineages.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle py-4">
                  <div className="min-w-0">
                    <p className="font-display text-xl">
                      <LineageName name={l.name} />
                    </p>
                    <p className="text-sm text-fg-muted">
                      Root:{' '}
                      <span lang="und-Latn" translate="no">
                        {l.root.displayName}
                      </span>{' '}
                      · {l.people.toLocaleString('en')} {l.people === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                  <Link href={`/explore?focus=${l.root.id}&lineage=${l.id}`} className={buttonVariants({ variant: 'secondary' })}>
                    {/* One flex item, so the space after "Explore" stays a space. */}
                    <span>
                      Explore <LineageName name={l.name} />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
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
