// The two location marks of a school (milestone M11): a solid pin for an exact location, a hollow
// dashed ring for a city-only school. Shape and words, never colour alone (CLAUDE.md §10). A module
// of their own, so the school form and the map islands take the two drawings without the list.

import { cx } from '@/lib/cx';

/** The marker of an exact location: a solid pin. Decorative: a text label always goes with it. */
export function ExactPinMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={cx('block shrink-0', className)}>
      <path d="M12 22s7-6.6 7-12.2A7 7 0 0 0 5 9.8C5 15.4 12 22 12 22z" fill="currentColor" stroke="var(--bg)" strokeWidth="1.4" />
      <circle cx="12" cy="9.6" r="2.4" fill="var(--bg)" />
    </svg>
  );
}

/** The marker of a city-only school: a hollow ring at the city's centre. Decorative, as above. */
export function CityRingMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" focusable="false" className={cx('block shrink-0', className)}>
      <circle cx="12" cy="12" r="8.2" fill="var(--bg)" stroke="currentColor" strokeWidth="2.6" strokeDasharray="4.2 2.6" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}
