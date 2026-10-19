// "Not on the record" (milestone M04): what a person's pages show for an address that was never
// used, a malformed one and a person the visitor may not see. The same words, markup and status
// (404) for all three, so the page reveals nothing about hidden records (plan §6.4, DEFAULT D03).
// src/proxy.ts answers such an address before the page renders: it rewrites it to an address no
// route uses, marked with NOT_ON_RECORD_HEADER (src/lib/not-on-record.ts), and the app's
// not-found page (src/app/not-found.tsx) renders this. A page that still finds no profile (the
// record was hidden between the two reads) renders it inline, never indexed.
//
// The mark is a brush stroke that ends in an open node: the line stops, with no record beyond it.

import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { inkShapes, type Cubic } from '@/design/ink';
import { InkShapeSvg } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button-variants';

export const notOnRecordMetadata: Metadata = {
  title: 'Not on the record',
  robots: { index: false, follow: false },
};

const STROKE: Cubic = [
  [4, 15],
  [38, 6],
  [70, 22],
  [104, 13],
];

/** A tapered stroke that runs into an open node (decorative). */
function EndOfLine() {
  return (
    <svg viewBox="0 0 124 28" width={124} height={28} aria-hidden="true" focusable="false" className="overflow-visible text-fg">
      <InkShapeSvg shape={inkShapes(STROKE, 'verified', { w0: 6.4, w1: 1.4, n: 40 })} />
      <circle cx={113} cy={13} r={6} fill="var(--bg)" stroke="var(--fg-muted)" strokeWidth={1.6} />
    </svg>
  );
}

export function PersonNotFound() {
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-page pt-12 pb-16 md:pt-20">
      <EndOfLine />
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
