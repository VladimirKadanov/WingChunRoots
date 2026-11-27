// The page for addresses that are not on the record (404): a mistyped address or a page that
// moved, with Search, Home and Schools (journey review P3-2).
//
// A person's address that shows nobody to this viewer (missing, malformed or hidden) also lands
// here: src/proxy.ts rewrites it to an address no route uses and marks the request
// (NOT_ON_RECORD_HEADER), and this page then says "Not on the record" in a person's terms
// (milestone M04). This is the one 404 page Next.js renders into the HTML itself (a notFound()
// thrown by a page is drawn only by JavaScript), so both answers work without JavaScript. It reads
// the request's headers and nothing else (no database).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LinkStroke } from '@/components/ink/link-stroke';
import { PersonNotFound } from '@/components/lineage/person-not-found';
import { buttonVariants } from '@/components/ui/button';
import { NOT_ON_RECORD_HEADER } from '@/lib/not-on-record';

// It reads a request header, so it cannot be prerendered: it renders per request and is allowed to
// block. The header is the only thing it waits for, and blocking keeps the words in the first HTML
// (a streamed part would be invisible without JavaScript).
export const instant = false;

export const metadata: Metadata = {
  title: 'Not on the record',
  robots: { index: false, follow: false },
};

export default async function NotFound() {
  if ((await headers()).get(NOT_ON_RECORD_HEADER) === 'person') return <PersonNotFound />;
  // Journey review P3-2: a plain "Page not found" with the three ways on.
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-page pt-12 pb-16 md:pt-20">
      <LinkStroke kind="unconfirmed" width={120} />
      <p className="eyebrow">404</p>
      <h1 className="max-w-[16ch] font-display text-section">Page not found</h1>
      <p className="max-w-[56ch] text-fg-muted">The address may be mistyped, or the page has moved.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/explore" className={buttonVariants({ variant: 'primary' })}>
          Search
        </Link>
        <Link href="/" className={buttonVariants({ variant: 'secondary' })}>
          Home
        </Link>
        <Link href="/schools" className={buttonVariants({ variant: 'secondary' })}>
          Schools
        </Link>
      </div>
    </div>
  );
}
