// Shared parts of the /dashboard/students pages (milestone M19; ADR 0072): how this account stands to
// a student, in words, and a titled block of the page.

import type { ReactNode } from 'react';

import type { PassportStudent } from '@/server/services/passport';

export const STUDENTS_PAGE = '/dashboard/students';
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The id of the page's <datalist> of the account's rank ladder (ADR 0072). */
export const LADDER_LIST = 'rank-ladder';

export const studentPage = (personId: string) => `${STUDENTS_PAGE}/${personId}`;

/** How this account stands to the student, in words. */
export function standing(student: PassportStudent): string {
  if (student.relationship === 'verified') return 'Your student · you record';
  if (student.relationship === 'in_arbitration') return 'In arbitration · read only';
  return `Member of ${student.organizations.map((o) => o.name).join(', ')} · you record for it`;
}

export function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} className="grid scroll-mt-24 gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** The account's rank ladder as suggestions of the rank fields: a pick list that still takes any rank. */
export function LadderList({ ladder }: { ladder: readonly string[] }) {
  if (ladder.length === 0) return null;
  return (
    <datalist id={LADDER_LIST}>
      {ladder.map((step) => (
        <option key={step} value={step} />
      ))}
    </datalist>
  );
}
