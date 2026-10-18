// "Not on the record" (milestone M04): what a person's pages show for an address that was never
// used and for a person the visitor may not see. The same words, markup and status for both, so
// the page reveals nothing about hidden records (plan §6.4, DEFAULT D03).
//
// Rendered by the page itself rather than thrown with notFound(): with Cache Components and
// Partial Prefetching the route's shell has already gone out with status 200 when the page
// renders, and a notFound() thrown after that leaves the HTML body empty for a browser without
// JavaScript. Rendered inline, the page works without JavaScript; it is never indexed, and the
// API answers the same request with 404 (docs/api/lineage.md).

import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { LinkStroke } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button-variants';

export const notOnRecordMetadata: Metadata = {
  title: 'Not on the record',
  robots: { index: false, follow: false },
};

export function PersonNotFound() {
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-page pt-12 pb-16 md:pt-20">
      <LinkStroke kind="unconfirmed" width={120} />
      <p className="eyebrow">Not on the record</p>
      <h1 className="max-w-[18ch] font-display text-section">No public profile at this address</h1>
      <p className="max-w-[56ch] text-fg-muted">
        The address may be mistyped, or the record is not public: a person appears here once a teaching link is confirmed and the
        record is shown.
      </p>
      <div>
        <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
          <ArrowLeftIcon />
          Back to Explore
        </Link>
      </div>
    </div>
  );
}
