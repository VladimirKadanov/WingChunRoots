// The page for addresses that are not on the record (404). Until their milestones, the
// Lineage, Schools and Me tabs land here too, so the copy says plainly what exists today.

import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/icons';
import { LinkStroke } from '@/components/ink/link-stroke';
import { buttonVariants } from '@/components/ui/button';

export const metadata: Metadata = {
  title: 'Not on the record',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <div className="mx-auto grid max-w-content content-start gap-5 px-[max(1rem,env(safe-area-inset-left,0px))] pt-12 pb-16 md:px-10 md:pt-20">
      <LinkStroke kind="unconfirmed" width={120} />
      <p className="eyebrow">404 · Not on the record</p>
      <h1 className="max-w-[16ch] font-display text-section">This page is not drawn yet</h1>
      <p className="max-w-[56ch] text-fg-muted">
        The address may be mistyped, or the page may open later in the pilot: the lineage explorer, the school finder and your own
        dashboard are still being built. The home page shows a demo lineage today.
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
