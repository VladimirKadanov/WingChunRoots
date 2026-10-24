'use client';

// The error state of a person's pages for anything the pages do not catch themselves (milestone
// M04, In scope 6): the failed profile read and the failed sections have their own states; this
// boundary is for the rest, inside the app shell and in the design's own terms, never Next.js's
// built-in screen. The message never shows the error itself; Retry fetches the page again.

import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';

export default function PersonPageError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <p className="eyebrow">Person on the record</p>
      <h1 className="max-w-[20ch] font-display text-section">This page could not be shown</h1>
      <ErrorPanel title="Something went wrong while drawing this record." className="max-w-[40rem]">
        <p className="max-w-[56ch] text-sm text-fg-muted">This is usually brief: try again in a moment.</p>
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => retry()} className={buttonVariants({ variant: 'secondary' })}>
            Retry
          </button>
          <Link href="/" className={buttonVariants({ variant: 'ghost' })}>
            <ArrowLeftIcon />
            Back to Explore
          </Link>
        </div>
      </ErrorPanel>
    </div>
  );
}
