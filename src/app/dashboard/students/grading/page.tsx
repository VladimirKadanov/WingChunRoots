// /dashboard/students/grading (role replay 2026-11-25, P2-8, ADR 0072): one grading day for several
// students at once instead of one form per student: the date, the awarded rank, the examiner, then
// a tick for each student who passed. Only the students this account records for (not those in
// arbitration). Data from passport.students; the change through a thin Server Action
// (./actions.ts) over passport.recordGrading. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { GRADING_FORM } from '../form-ids';
import { LADDER_LIST, LadderList, STUDENTS_PAGE, standing } from '../parts';
import { GradingForm } from './grading-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Record a grading',
  robots: { index: false },
};

const PAGE = `${STUDENTS_PAGE}/grading`;

export default async function GradingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const view = await pageRead(client.passport.students({}));
  if (view === null) {
    return (
      <LoadError
        eyebrow="Your students"
        title="Record a grading"
        message="We couldn't load your students. Nothing was changed."
        retryHref={PAGE}
        back={{ href: STUDENTS_PAGE, label: 'Back to your students' }}
      />
    );
  }
  const outcome = await readFormResult(GRADING_FORM, query.outcome);
  const students = view.students
    .filter((s) => s.canRecord)
    .map((s) => ({ personId: s.personId, name: s.name.value, lang: s.name.lang, standing: standing(s) }));

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[44rem]">
        <p className="eyebrow">
          <Link href={STUDENTS_PAGE} className="link inline-flex min-h-11 items-center">
            Your students
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Record a grading</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Enter the grading once, then tick the students who passed. Each of them gets the examination in their passport and is told. You can change or withdraw an entry later
          from the student’s passport.
        </p>
        {view.ladder.length === 0 ? (
          <p className="mt-3 text-ui">
            <Link href={`${STUDENTS_PAGE}/ladder`} className="link inline-flex min-h-11 items-center">
              Set your rank ladder
            </Link>{' '}
            <span className="text-fg-muted">once, and pick the rank from it.</span>
          </p>
        ) : null}
        <LadderList ladder={view.ladder} />
        <div className="mt-8">
          {students.length === 0 ? (
            <p className="text-fg-muted" data-testid="grading-empty">
              No students you can record for yet. Once you approve a student’s request, they are here.
            </p>
          ) : (
            <GradingForm
              students={students}
              examiners={view.gradingExaminers.map((e) => ({ value: e.personId, label: `${e.name.value} (${e.note})` }))}
              organizations={view.organizations.map((o) => ({ value: o.id, label: o.name }))}
              ladder={view.ladder.length > 0 ? LADDER_LIST : undefined}
              teacher={view.gradingExaminers.some((e) => e.note === 'You')}
              initial={outcome}
            />
          )}
        </div>
      </div>
    </div>
  );
}
