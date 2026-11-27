// /dashboard/students (milestone M19, In scope 2 and 7; docs/adr/0022-passport.md): the students
// this account records for: its established students (a verified relationship records, one in
// arbitration is read only) and the members of the approved organizations it administers. Each
// student's passport has its own page, /dashboard/students/<person id> (role replay 2026-11-25,
// P2-8, ADR 0072); an old ?student=<person id> address goes there. "Record a grading" records one
// grading for several students at once, and "Your rank ladder" sets the ranks the forms offer.
// DEFAULT M19 (question 1): the student never records their own. The requests that wait for this
// teacher stay at /dashboard/students/requests (M09). Data from passport.students. Reads the
// session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { Block, STUDENTS_PAGE, standing, studentPage, UUID } from './parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your students’ passports',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

/** P3-11: from this many students the list has a name filter. */
const STUDENT_FILTER_FROM = 10;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

export default async function StudentsPassportPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(STUDENTS_PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  // The address before each passport had its own page.
  if (UUID.test(one(query.student))) return <PageRedirect to={studentPage(one(query.student).toLowerCase())} />;
  const client = serverClient(await headers(), guard.principal);
  const view = await pageRead(client.passport.students({}));
  if (view === null) {
    return (
      <LoadError
        eyebrow="Dashboard"
        title="Your students’ passports"
        message="We couldn't load your students. Nothing was changed."
        retryHref={STUDENTS_PAGE}
        back={{ href: '/dashboard', label: 'Back to the dashboard' }}
      />
    );
  }
  const graded = Number.parseInt(one(query.graded), 10);
  const notice =
    Number.isFinite(graded) && graded > 0
      ? `The grading is recorded for ${graded === 1 ? 'one student' : `${graded} students`}. Each of them was told.`
      : query.ladder === '1'
        ? 'Your rank ladder is saved.'
        : null;
  const canGrade = view.students.some((s) => s.canRecord);
  // Journey review P3-11: a long list gets a name filter (without JavaScript: a GET form).
  const q = one(query.q).trim().slice(0, 100);
  const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
  const shown = q ? view.students.filter((s) => fold(s.name.value).includes(fold(q))) : view.students;
  const filterable = view.students.length > STUDENT_FILTER_FROM;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow max-lg:hidden">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your students’ passports</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          You record the ranks, examinations, forms and skills of the students whose relationship with you is verified, and of the members of an organization you
          administer. Each student decides what their profile shows and can propose a correction.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 text-ui">
          {canGrade ? (
            <Link href={`${STUDENTS_PAGE}/grading`} className="link inline-flex min-h-11 items-center" data-testid="students-grading-link">
              Record a grading
            </Link>
          ) : null}
          {view.hasProfile ? (
            <Link href={`${STUDENTS_PAGE}/ladder`} className="link inline-flex min-h-11 items-center" data-testid="students-ladder-link">
              Your rank ladder
            </Link>
          ) : null}
          <Link href="/dashboard/students/requests" className="link inline-flex min-h-11 items-center">
            Student requests
          </Link>
        </p>
        {notice ? (
          <p role="status" className="mt-4 text-ui font-semibold" data-testid="students-notice">
            {notice}
          </p>
        ) : null}

        <div className="mt-8 grid gap-10">
          <Block id="students" title="Students">
            {view.students.length === 0 ? (
              <p className="text-fg-muted" data-testid="students-empty">
                {view.hasProfile
                  ? 'No students yet. Once you approve a student’s request, their passport is here.'
                  : 'You have no profile yet. Finish setting up your profile first: you record for your students from it.'}
              </p>
            ) : (
              <>
              {filterable || q ? (
                <form method="get" action={STUDENTS_PAGE} role="search" aria-label="Find a student" className="mb-3 flex flex-wrap items-end gap-3" data-testid="students-filter">
                  <label className="grid gap-1.5 text-sm font-semibold">
                    Student&apos;s name
                    <input
                      name="q"
                      type="search"
                      defaultValue={q}
                      maxLength={100}
                      autoComplete="off"
                      className="min-h-11 w-[min(22rem,100%)] rounded-sm border border-border-strong bg-bg px-3 text-ui font-normal"
                    />
                  </label>
                  <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                    Find
                  </button>
                  {q ? (
                    <Link href={STUDENTS_PAGE} className="link inline-flex min-h-11 items-center text-ui">
                      Show all {view.students.length}
                    </Link>
                  ) : null}
                </form>
              ) : null}
              {q && shown.length === 0 ? (
                <p className="text-fg-muted" data-testid="students-filter-empty">
                  No student&apos;s name contains “{q}”.
                </p>
              ) : null}
              <ul className="grid gap-1" aria-label="Your students">
                {shown.map((s) => (
                  <li key={s.personId} data-testid="passport-student" data-relationship={s.relationship ?? 'organization'}>
                    <Link href={studentPage(s.personId)} className="flex min-h-11 flex-wrap items-center gap-x-3 rounded-sm px-2 py-1.5 hover:bg-surface-2">
                      <span className="link font-display text-lg">
                        <NameText name={s.name} />
                      </span>
                      <span className="text-sm text-fg-muted">{standing(s)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
              </>
            )}
          </Block>
        </div>
      </div>
    </div>
  );
}
