// /explore (plan §4.1, §4.3; milestone M05): the interactive lineage explorer. The page reads the
// view's graph on the server through the same procedure the browser calls (lineage.ego or
// lineage.subtree), so the client island starts with its data, and, for view=list, renders the
// M04 list view of the person in focus. The graph itself is drawn by the client island
// (src/components/lineage/explorer), which loads React Flow and the ELK layout worker only here.
// Without a person in focus the page offers the public lineages as starting points.
//
// The explorer fills the dynamic viewport height between the app shell's bars, inside the safe
// areas (plan §5.8 (b)).

import type { Metadata } from 'next';
import Link from 'next/link';
import { Suspense } from 'react';

import { Explorer } from '@/components/lineage/explorer/explorer';
import { explorerRead, paramsFrom, readKey } from '@/components/lineage/explorer/state';
import { buttonVariants } from '@/components/ui/button-variants';
import type { LineageGraphDto } from '@/server/dto/public';
import { ORPCError } from '@/server/rpc/server';
import LineageListPage from '../people/[slug]/lineage/page';
import { failure, lineageClient } from '../people/[slug]/data';

export const instant = false;

export const metadata: Metadata = {
  title: 'Explorer',
  robots: { index: false },
};

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** The explorer's frame: the dynamic viewport between the shell's top bar and its tab bar (phones), the whole height beside the rail (desktop). */
const FRAME = 'h-[calc(100dvh-var(--top-h)-env(safe-area-inset-top,0px)-var(--page-clear-bottom))] md:h-dvh';

/** The address of the person in focus, read on its own (no teachers, no students); null when not on the record. */
async function focusSlug(client: Awaited<ReturnType<typeof lineageClient>>, focusId: string): Promise<string | null> {
  try {
    const alone = await client.lineage.ego({ focusId, up: 0, down: 0 });
    return alone.nodes.find((n) => n.id === focusId)?.slug ?? null;
  } catch {
    return null;
  }
}

export default async function ExplorePage({ searchParams }: Props) {
  const params = paramsFrom(await searchParams);
  const client = await lineageClient();
  const starts = await client.lineage.start().catch((error: unknown) => {
    console.error(`[explore] the starting points could not be loaded: ${failure(error)}`);
    return { lineages: [] };
  });

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
          {starts.lineages.length === 0 ? (
            <p className="mt-8 border-t border-border-subtle pt-5 text-ui text-fg-muted">No lineage with a public root is on the record yet.</p>
          ) : (
            <ul className="mt-8 grid border-t border-border-subtle">
              {starts.lineages.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle py-4">
                  <div className="min-w-0">
                    <p className="font-display text-xl">{l.name}</p>
                    <p className="text-sm text-fg-muted">
                      Root:{' '}
                      <span lang="und-Latn" translate="no">
                        {l.root.displayName}
                      </span>{' '}
                      · {l.people.toLocaleString('en')} {l.people === 1 ? 'person' : 'people'}
                    </p>
                  </div>
                  <Link href={`/explore?focus=${l.root.id}&lineage=${l.id}`} className={buttonVariants({ variant: 'secondary' })}>
                    Explore {l.name}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  const lineageRoot = starts.lineages.find((l) => l.id === params.lineage)?.root.id ?? null;
  // The server cannot know the screen's width: it reads the desktop defaults (plan §4.3), and a
  // phone asks for its smaller view itself.
  const read = explorerRead({ ...params, focus: params.focus }, lineageRoot, false);
  let graph: LineageGraphDto | null = null;
  try {
    graph = read.procedure === 'ego' ? await client.lineage.ego(read.input) : await client.lineage.subtree(read.input);
  } catch (error) {
    if (!(error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST'))) {
      console.error(`[explore] the lineage could not be loaded: ${failure(error)}`);
    }
  }
  // The focus may be outside the graph (the lineage view starts at the root, three generations
  // deep) or the graph read may have failed: the list view then asks for the person alone.
  const slug = graph?.nodes.find((n) => n.id === params.focus)?.slug ?? (params.view === 'list' ? await focusSlug(client, params.focus) : null);
  const list =
    params.view !== 'list' ? null : slug ? (
      <LineageListPage params={Promise.resolve({ slug })} searchParams={Promise.resolve({})} />
    ) : (
      <p role="status" className="p-6 text-ui text-fg-muted">
        There is no public profile with this address in the record.
      </p>
    );

  return (
    <div className={FRAME}>
      <Suspense fallback={null}>
        <Explorer initial={graph ? { key: readKey(read), graph } : null} starts={starts.lineages} list={list} />
      </Suspense>
    </div>
  );
}
