// The mark of a person (Ink Register): a square on its point for a recorded founder, a filled dot
// for the living, a ring otherwise. The routes of descent (M04) and the explorer's cards (owner
// decision 2026-10-31, "Ink restyle") draw it, and their keys explain it (ROUTE_MARK_LABELS).

import { cx } from '@/lib/cx';

/**
 * The mark of a person on a route: a square on its point for a recorded founder (DEFAULT D22), a
 * filled dot for the living, a ring otherwise. The key explains them where routes are drawn
 * (LineageKey `marks`), and a screen reader hears "Founder of …, as recorded" or "Living" in the
 * step's text (final check, screens-4).
 */
export type RouteMarkKind = 'founder' | 'living' | 'other';

export const ROUTE_MARK_LABELS: Record<RouteMarkKind, string> = {
  founder: 'Founder, as recorded',
  living: 'Living',
  other: 'Not recorded as living',
};

/** The marks in a key's order. */
export const MARK_ORDER: RouteMarkKind[] = ['founder', 'living', 'other'];

export function RouteMark({ mark, className }: { mark: RouteMarkKind; className?: string }) {
  return (
    <span aria-hidden="true" data-mark={mark} className={cx('block size-2.5', className)}>
      {mark === 'founder' ? (
        <span className="block size-full rotate-45 bg-fg" />
      ) : mark === 'living' ? (
        <span className="block size-full rounded-full bg-fg" />
      ) : (
        <span className="block size-full rounded-full border-[1.5px] border-fg bg-bg" />
      )}
    </span>
  );
}

/** The marks a drawing shows, in the key's order: a key lists only what is drawn. */
export function markKinds(drawn: Iterable<RouteMarkKind>): RouteMarkKind[] {
  const set = new Set(drawn);
  return MARK_ORDER.filter((mark) => set.has(mark));
}

/** A short key to the marks, beside a legend of link states. */
export function MarkKey({ marks, className }: { marks: readonly RouteMarkKind[]; className?: string }) {
  if (marks.length === 0) return null;
  return (
    <ul aria-label="Legend: people" data-mark-key="" className={cx('flex flex-wrap gap-x-5 gap-y-2', className)}>
      {marks.map((mark) => (
        <li key={mark} className="flex items-center gap-2 text-sm text-fg">
          <RouteMark mark={mark} />
          <span className="font-semibold">{ROUTE_MARK_LABELS[mark]}</span>
        </li>
      ))}
    </ul>
  );
}
