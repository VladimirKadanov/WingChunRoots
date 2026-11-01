// The school of a listing case on the case card (milestone M11, In scope 2): its name, city,
// location mode, contacts, forms and instructors, and whether the account that listed it holds
// Professional Sifu now (the pin shows once the listing is approved only then: DEFAULT D08/D18).
// A listed school is on the card again when its Sifu changed what it is, where, its website or its
// instructors (schools.update, RE_REVIEWED_CHANGES): the card says so.
// The point is shown only for an exact location: a city-only school's private point never reaches
// the card (school-review.ts).

import { PersonName } from '@/components/relationships/parts';
import { LocationTag } from '@/components/schools/school-list';
import type { SchoolCaseView } from '@/server/services/school-review';

export function ListingSection({ school, reason }: { school: SchoolCaseView; reason: string | null }) {
  const rows: [string, string | null][] = [
    ['Website', school.websiteUrl],
    ['E-mail', school.contactEmail],
    ['Phone', school.contactPhone],
  ];
  return (
    <section id="listing" aria-labelledby="listing-heading" className="grid content-start gap-3 border-t border-border-subtle pt-6" data-testid="case-listing">
      <h2 id="listing-heading" className="font-display text-2xl">
        The listing
      </h2>
      {school.status === 'active' ? (
        <p className="max-w-[60ch] rounded-sm border-l-4 border-fg bg-surface-2 px-3 py-2 text-sm" data-testid="listing-edited">
          This school is listed. Its Sifu changed it after the approval, and the changes are public now. Approve them to keep the listing as it is, or return it to
          draft with a reason to take it off the map.
        </p>
      ) : null}
      <p className="font-display text-xl [overflow-wrap:anywhere]">{school.name}</p>
      <p className="text-ui text-fg-muted">
        {school.city}, {school.countryCode} · {school.locationLabel}
      </p>
      <LocationTag precision={school.locationPrivacy === 'exact' ? 'exact' : 'city'} />
      {school.point ? (
        <p className="text-sm text-fg-muted" translate="no">
          Pin {school.point.lat}, {school.point.lng}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">The map shows it at the centre of {school.city}; its address stays private.</p>
      )}
      <p className="text-sm" data-testid="listing-plan">
        {school.pinAllowed
          ? 'The account that listed it holds Professional Sifu: once approved, its pin shows on the map.'
          : 'The account that listed it does not hold Professional Sifu now: once approved, the school is listed but its pin does not show.'}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-fg-muted">{label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">{value ?? '—'}</dd>
          </div>
        ))}
        <dt className="text-fg-muted">Forms</dt>
        <dd>{school.forms.length > 0 ? school.forms.join(', ') : '—'}</dd>
      </dl>
      {school.description ? <p className="max-w-[60ch] text-ui whitespace-pre-line">{school.description}</p> : null}
      <div className="grid gap-1">
        <span className="text-sm text-fg-muted">Instructors</span>
        <ul className="grid gap-1">
          {school.instructors.map((i) => (
            <li key={i.person.id} className="flex flex-wrap items-baseline gap-x-2">
              <PersonName person={i.person} />
              <span className="text-sm text-fg-muted">{i.roleLabel}</span>
            </li>
          ))}
        </ul>
      </div>
      {reason ? (
        <p className="max-w-[60ch] text-sm whitespace-pre-line">
          <span className="font-semibold">Decision note: </span>
          {reason}
        </p>
      ) : null}
    </section>
  );
}
