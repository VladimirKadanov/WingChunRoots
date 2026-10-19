// The key of the lineage screens (plan §4.6; milestone M04): the shared ink Legend with the
// states this page draws and nothing else. The dotted "?" state is only ever a request here,
// which only its two participants see (DEFAULT D03), so these screens name it "Pending"; the
// same seal reads "Unconfirmed" where it marks a mention nobody has claimed (ADR 0006).
// It sits in the page's rail (person-layout.tsx): a compact row under the header on a phone, the
// states with their descriptions in the sticky side column from 1280 px, so it is always in view.
// Where routes of descent are drawn, it also explains the marks on a route (`marks`, final check,
// screens-4): the founder's square, the filled dot of the living and the ring.

import { Legend, legendKinds, type LegendWording } from '@/components/ink/legend';
import type { LinkKind } from '@/components/ink/link-stroke';
import { cx } from '@/lib/cx';
import { ROUTE_MARK_LABELS, RouteMark, type RouteMarkKind } from './routes-of-descent';

export const LINEAGE_WORDING: Partial<Record<LinkKind, LegendWording>> = {
  unconfirmed: { label: 'Pending', description: 'A request the teacher has not answered. Only the two people in it can see it.' },
};

export function LineageKey({
  kinds,
  marks = [],
  className,
}: {
  kinds: Iterable<LinkKind>;
  /** The marks the page's routes of descent draw (routeMarks), in that order. */
  marks?: readonly RouteMarkKind[];
  className?: string;
}) {
  const list = legendKinds(kinds);
  if (list.length === 0 && marks.length === 0) return null;
  return (
    <section aria-labelledby="key-heading" className={cx('grid gap-2 xl:gap-3', className)}>
      <h2 id="key-heading" className="eyebrow">
        Key
      </h2>
      {list.length > 0 ? <Legend kinds={list} labels={LINEAGE_WORDING} layout="adaptive" descriptions="xl" /> : null}
      {marks.length > 0 ? (
        <div className="grid gap-1 xl:gap-2">
          <p id="key-marks-heading" className="text-sm text-fg-muted">
            Marks on a route
          </p>
          <ul aria-labelledby="key-marks-heading" className="flex flex-wrap gap-x-5 gap-y-2 xl:grid xl:gap-2">
            {marks.map((mark) => (
              <li key={mark} className="flex items-center gap-2">
                <span className="grid w-[34px] place-items-center">
                  <RouteMark mark={mark} />
                </span>
                <span className="text-sm font-semibold text-fg">{ROUTE_MARK_LABELS[mark]}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
