// The parts of a teacher-student link on the request pages (milestone M09): the other person's
// names, the state as a seal and a word (never colour alone, plan §4.6), and the training periods
// as text with their schools. Server components (no state); shared by /dashboard/teachers,
// /dashboard/teachers/new and /dashboard/students/requests.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import type { LinkKind } from '@/components/ink/link-stroke';
import { periodText } from '@/components/lineage/status';
import { StatusBadge } from '@/components/ui/status-badge';
import type { PersonRef } from '@/server/services/dashboard';
import type { RelationshipView } from '@/server/services/relationships';
import { FocusOnShow } from './focus-on-show';
import { OUTCOME_ID } from './outcome-id';

/** The seal of a link's state: an ended training is historical; a request is unconfirmed. */
export function badgeOf(view: Pick<RelationshipView, 'status' | 'historical'>): LinkKind {
  switch (view.status) {
    case 'verified':
      return view.historical ? 'historical' : 'verified';
    case 'in_arbitration':
      return 'arbitration';
    case 'under_review':
      return 'under_review';
    default:
      return 'unconfirmed';
  }
}

export function RelationshipBadge({ view }: { view: Pick<RelationshipView, 'status' | 'historical' | 'statusLabel'> }) {
  return <StatusBadge state={badgeOf(view)} label={view.statusLabel} />;
}

/**
 * A person's names: the Latin-script display name and the name in its own script, each with its
 * `lang` and translate="no" (plan §5.3). A link to the profile only when `link` is set and the
 * profile is public (a request's person may not be).
 */
export function PersonName({ person, link = false, className = 'font-display text-lg' }: { person: PersonRef; link?: boolean; className?: string }) {
  // A removed profile keeps its row, anonymous: a UI text, not a name (M08 final check, security-2).
  if (person.removed) return <span className={`${className} text-fg-muted`}>{person.name.value}</span>;
  const names = (
    <>
      <NameText name={person.name} />
      {person.original ? <NameText name={person.original} className="text-[0.78em] text-fg-muted" /> : null}
    </>
  );
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-[0.42em] [overflow-wrap:anywhere] ${className}`}>
      {link && person.slug ? (
        // A tap target of at least 44 px (CLAUDE.md §10, M09 review screens-5): the link is the
        // row's own control, not a link inside running text. The names keep their shared baseline.
        <Link href={`/people/${person.slug}`} className="link inline-flex min-h-11 items-center">
          <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em]">{names}</span>
        </Link>
      ) : (
        names
      )}
    </span>
  );
}

/** "Apr 2019 – present at Demo School, Sofia", one line per period. */
export function PeriodLines({ periods }: { periods: RelationshipView['periods'] }) {
  if (periods.length === 0) return <span>Dates not recorded</span>;
  return (
    <ul className="grid gap-0.5">
      {periods.map((period, index) => (
        <li key={index}>
          {periodText([period])}
          {period.school ? <span className="text-fg-muted"> · {period.school.name}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * The line that says what a change did ("Your request was sent…"). It takes the focus, so a screen
 * reader reads it and a phone shows it (M09 review, screens-1). Without JavaScript the action's
 * redirect names it (`#outcome`): the browser opens the page at it and focuses it, and `autofocus`
 * covers a load without that fragment. With JavaScript FocusOnShow focuses it once the router
 * shows the page. Scrolled to, it stops a little below the phone's top bar (`scroll-mt-3`), so
 * the bar's border covers neither the note nor its focus ring (WCAG 2.4.11).
 */
export function OutcomeNote({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <FocusOnShow
      id={OUTCOME_ID}
      data-testid={testId}
      role="status"
      tabIndex={-1}
      autoFocus
      className="scroll-mt-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm text-fg outline-offset-4"
    >
      {children}
    </FocusOnShow>
  );
}
