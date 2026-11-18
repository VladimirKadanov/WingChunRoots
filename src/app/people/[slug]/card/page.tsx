// /people/[slug]/card (owner decision 2026-11-18, docs/adr/0045-lineage-card.md): a member's
// lineage card. One public route of descent at a time, the longest first; a member with several
// teachers picks another route with plain links (?route=N), so the page works without JavaScript.
// "Print or save as PDF" opens the browser's print dialog (the print stylesheet keeps the card
// alone, on paper colours); "Share image" is the card as a PNG (./image).
//
// people.card answers only for a public person whose plan includes the card; for anyone else the
// page shows the same "Not on the record" as a missing address (plan §6.4), never indexed. The page
// streams, so that answer comes inline (as the person pages' own fallback); the share image, a
// route handler, answers 404.

import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { cardSteps, generationsText, LineageCard, routeLineage } from '@/components/lineage/lineage-card';
import { LatinName } from '@/components/lineage/person-name';
import { notOnRecordMetadata, PersonNotFound } from '@/components/lineage/person-not-found';
import { PrintButton } from '@/components/lineage/print-button';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { chosenRoute } from '@/lib/lineage-card-route';
import type { LineageCardDto } from '@/server/dto/public';

import { failure, lineageClient } from '../data';

export const instant = false;

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CardRead = { state: 'found'; card: LineageCardDto } | { state: 'none' } | { state: 'failed' };

async function readCard(slug: string): Promise<CardRead> {
  // Outside the try: the request's connection() must reject on its own when a prerender ends.
  const client = await lineageClient();
  try {
    return { state: 'found', card: await client.people.card({ slug }) };
  } catch (error) {
    if (failure(error) === 'NOT_FOUND' || failure(error) === 'BAD_REQUEST') return { state: 'none' };
    console.error(`[lineage-card] the card could not be loaded: ${failure(error)}`);
    return { state: 'failed' };
  }
}

function focusName(card: LineageCardDto): string {
  return card.paths.nodes.find((n) => n.id === card.personId)?.displayName ?? 'This member';
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const read = await readCard(slug);
  if (read.state === 'none') return notOnRecordMetadata;
  if (read.state !== 'found') return { title: 'Lineage card', robots: { index: false, follow: false } };
  const name = focusName(read.card);
  return {
    title: `${name} · Lineage card`,
    description: `The route of descent of ${name} on WingChunRoots, from the earliest known teacher.`,
    robots: { index: false },
    openGraph: { images: [{ url: `/people/${slug}/card/image`, width: 1200, height: 630, alt: `Lineage card of ${name}` }] },
  };
}

export default async function LineageCardPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const read = await readCard(slug);
  if (read.state === 'none') return <PersonNotFound />;
  const here = `/people/${slug}`;
  if (read.state === 'failed') {
    return (
      <div className="mx-auto grid max-w-content content-start gap-4 px-page pt-10 pb-16">
        <p className="eyebrow">Lineage card</p>
        <h1 className="font-display text-section">The card did not load</h1>
        <p className="text-fg-muted">Nothing was changed. Try again in a moment.</p>
        <p>
          <a href={`${here}/card`} className={buttonVariants({ variant: 'secondary' })}>
            Try again
          </a>
        </p>
      </div>
    );
  }
  const { card } = read;
  const name = focusName(card);
  const routes = card.paths.paths;
  const index = chosenRoute(card, (await searchParams).route);
  return (
    <div className="mx-auto grid max-w-content content-start gap-6 px-page pt-8 pb-16 print:max-w-none print:p-0">
      <div className="grid gap-2 print:hidden">
        <p>
          <Link href={here} prefetch={false} className="link inline-flex min-h-11 items-center gap-2">
            <ArrowLeftIcon />
            <span>
              Back to the profile of <LatinName name={name} />
            </span>
          </Link>
        </p>
        <h1 className="font-display text-section">
          Lineage card of <LatinName name={name} />
        </h1>
        <p className="max-w-[60ch] text-fg-muted">
          The route of descent from the earliest known teacher, through confirmed teaching links. Only people with public profiles
          are shown.
        </p>
      </div>
      {index === -1 ? (
        <p className="rounded-sm border border-border-subtle p-6 text-fg-muted" data-testid="lineage-card-empty">
          No confirmed public teacher is on the record for <LatinName name={name} /> yet, so there is no route to show.
        </p>
      ) : (
        <>
          {routes.length > 1 ? (
            <nav aria-labelledby="routes-heading" className="grid gap-2 print:hidden" data-testid="lineage-card-routes">
              <h2 id="routes-heading" className="text-sm font-semibold">
                Routes of descent ({routes.length})
              </h2>
              <ul className="flex flex-wrap gap-2">
                {routes.map((route, i) => {
                  const lineage = routeLineage(card, i);
                  const current = i === index;
                  return (
                    <li key={route.edgeIds.join('-') || i}>
                      <Link
                        href={`${here}/card?route=${i + 1}`}
                        prefetch={false}
                        scroll={false}
                        aria-current={current ? 'page' : undefined}
                        className={cx(
                          'inline-flex min-h-11 items-center gap-2 rounded-sm border px-3 text-sm',
                          current ? 'border-fg bg-fg font-semibold text-fg-inverse' : 'border-border-strong hover:bg-surface-3',
                        )}
                      >
                        {current ? <span aria-hidden="true">●</span> : null}
                        <span>
                          {lineage ? <span translate="no">{lineage}</span> : `Route ${i + 1}`} · {generationsText(cardSteps(card, i).length)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : null}
          <LineageCard card={card} index={index} />
          <div className="grid gap-3 print:hidden" data-testid="lineage-card-actions">
            <div className="flex flex-wrap gap-3">
              <PrintButton />
              <a
                href={`${here}/card/image?route=${index + 1}`}
                download={`lineage-card-${slug}.png`}
                className={buttonVariants({ variant: 'secondary' })}
                data-testid="share-image"
              >
                Share image
              </a>
            </div>
            <p className="text-sm text-fg-muted">
              To make a PDF, choose “Save as PDF” in the print dialog. The share image is a picture of this route to post or send.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
