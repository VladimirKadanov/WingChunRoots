// The key of the lineage screens (plan §4.6; milestone M04): the shared ink Legend with the
// states this page draws and nothing else. The dotted "?" state is only ever a request here,
// which only its two participants see (DEFAULT D03), so these screens name it "Pending"; the
// same seal reads "Unconfirmed" where it marks a mention nobody has claimed (ADR 0006).
// It sits in the page's rail (person-layout.tsx): a compact row under the header on a phone, the
// states with their descriptions in the sticky side column from 1280 px, so it is always in view.

import { Legend, legendKinds, type LegendWording } from '@/components/ink/legend';
import type { LinkKind } from '@/components/ink/link-stroke';
import { cx } from '@/lib/cx';

export const LINEAGE_WORDING: Partial<Record<LinkKind, LegendWording>> = {
  unconfirmed: { label: 'Pending', description: 'A request the teacher has not answered. Only the two people in it can see it.' },
};

export function LineageKey({ kinds, className }: { kinds: Iterable<LinkKind>; className?: string }) {
  const list = legendKinds(kinds);
  if (list.length === 0) return null;
  return (
    <section aria-labelledby="key-heading" className={cx('grid gap-2 xl:gap-3', className)}>
      <h2 id="key-heading" className="eyebrow">
        Key
      </h2>
      <Legend kinds={list} labels={LINEAGE_WORDING} layout="adaptive" descriptions="xl" />
    </section>
  );
}
