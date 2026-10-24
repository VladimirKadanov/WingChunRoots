// The frame of a person's pages (milestone M04; design review round 1): the header, a side rail
// and the main column. On a phone the order is header, rail (the view switch and a compact key,
// so the lineage itself is on the first screen; direction decision 10), then the sections. From
// 1280 px the rail is a sticky column on the right with the counts, the view switch, the jump
// links and the key with its descriptions, and the sections use the wide main column, as the
// home page composes its two columns.

import type { ReactNode } from 'react';

import { cx } from '@/lib/cx';

export function PersonLayout({ header, rail, children }: { header: ReactNode; rail: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div
        className={cx(
          'grid grid-cols-[minmax(0,1fr)] gap-y-6 [grid-template-areas:"head"_"rail"_"main"]',
          'xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-[auto_1fr] xl:gap-x-14 xl:gap-y-8 xl:[grid-template-areas:"head_rail"_"main_rail"]',
        )}
      >
        <header className="grid max-w-[52rem] content-start gap-3 [grid-area:head]">{header}</header>
        <aside
          aria-label="About this record"
          className="grid max-w-[52rem] content-start gap-5 [grid-area:rail] xl:sticky xl:top-6 xl:self-start xl:border-l xl:border-border-subtle xl:pl-8"
        >
          {rail}
        </aside>
        <div className="grid max-w-[52rem] min-w-0 content-start gap-10 [grid-area:main] xl:max-w-none">{children}</div>
      </div>
    </div>
  );
}
