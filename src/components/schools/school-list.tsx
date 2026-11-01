// The school finder's list (milestone M11; plan §5.3, §5.6): one row per school with its name (the
// link to its page), its city, its distance from the search centre in whole kilometres, its
// instructors and how its location is shown. Shared by the server page (the list view, and the
// fallback without WebGL2) and the client island (the side list and the phone's sheet), so both
// show the same rows. No hooks: it renders on the server and in the client alike.
//
// Location is never told by colour alone (CLAUDE.md §10): an exact location has a solid pin and
// the words "Exact location"; a city-only school a hollow ring and "Private club, by invitation".

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { cx } from '@/lib/cx';
import type { SchoolPinDto } from '@/server/dto/schools';

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

export const EXACT_LABEL = 'Exact location';
export const CITY_ONLY_LABEL = 'Private club, by invitation';

/** The words of a school's location: exact, or city only. */
export function locationText(school: Pick<SchoolPinDto, 'precision' | 'city'>): string {
  return school.precision === 'exact' ? EXACT_LABEL : `${CITY_ONLY_LABEL} · ${school.city} (city only)`;
}

export function LocationTag({ precision, className }: { precision: SchoolPinDto['precision']; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-sm', className)} data-precision={precision}>
      {precision === 'exact' ? <ExactPinMark size={18} /> : <CityRingMark size={18} />}
      {precision === 'exact' ? EXACT_LABEL : CITY_ONLY_LABEL}
    </span>
  );
}

/** "23 schools within 50 km · Demo Lineage A": the finder's summary line (plan M11, In scope 6). */
export function summaryText(count: number, radiusKm: number | null, near: string | null, lineage: string | null): string {
  const schools = `${count.toLocaleString('en')} ${count === 1 ? 'school' : 'schools'}`;
  const where = radiusKm === null ? '' : ` within ${radiusKm} km${near ? ` of ${near}` : ''}`;
  return `${schools}${where}${lineage ? ` · ${lineage}` : ' · all lineages'}`;
}

export interface SchoolListProps {
  schools: readonly SchoolPinDto[];
  /** The selected school (the map's pin), marked and scrolled to by the island. */
  selectedId?: string | null;
  /** With the map: "Show on the map" for each school. */
  onShow?: (id: string) => void;
  className?: string;
}

export function SchoolList({ schools, selectedId = null, onShow, className }: SchoolListProps) {
  return (
    <ul className={cx('grid', className)} data-testid="school-list">
      {schools.map((school) => {
        const selected = school.id === selectedId;
        return (
          <li
            key={school.id}
            data-id={school.id}
            data-testid="school-row"
            data-slug={school.slug}
            data-selected={selected ? 'true' : undefined}
            className={cx(
              'grid gap-1 border-b border-border-subtle py-3 pl-3',
              // The selected row: a solid ink bar and bold name, never colour alone.
              selected ? 'border-l-4 border-l-fg' : 'border-l-4 border-l-transparent',
            )}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <Link href={`/schools/${school.slug}`} className={cx('link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]', selected && 'font-bold')}>
                {school.name}
              </Link>
              {school.distanceKm !== null ? (
                <span className="text-sm text-fg-muted" data-testid="school-distance">
                  {school.distanceKm.toLocaleString('en')} km
                </span>
              ) : null}
            </div>
            <p className="text-sm text-fg-muted">
              {school.city}, {school.countryCode}
            </p>
            <LocationTag precision={school.precision} />
            {school.instructors.length > 0 ? (
              <p className="text-sm">
                <span className="text-fg-muted">{school.instructors.length === 1 ? 'Instructor ' : 'Instructors '}</span>
                {school.instructors.map((instructor, i) => (
                  <span key={instructor.id}>
                    {i > 0 ? ', ' : null}
                    <NameText name={instructor.displayName} />
                  </span>
                ))}
              </p>
            ) : null}
            {onShow ? (
              <p>
                <button
                  type="button"
                  className="link inline-flex min-h-11 items-center text-sm"
                  aria-pressed={selected}
                  onClick={() => onShow(school.id)}
                  data-testid="show-on-map"
                >
                  Show on the map<span className="sr-only">: {school.name}</span>
                </button>
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
