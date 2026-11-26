// /dashboard/students/ladder (role replay 2026-11-25, P2-8, ADR 0072): the account's rank ladder,
// set once ("First level", "Second level"…) and offered as the pick list of the rank fields on the
// students' passports and on "Record a grading". Only words, kept with the account. Data from
// passport.students; the change through a thin Server Action (./actions.ts) over passport.setLadder.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { LADDER_FORM } from '../form-ids';
import { STUDENTS_PAGE } from '../parts';
import { LadderForm } from './ladder-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your rank ladder',
  robots: { index: false },
};

const PAGE = `${STUDENTS_PAGE}/ladder`;

export default async function LadderPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
        title="Your rank ladder"
        message="We couldn't load your rank ladder. Nothing was changed."
        retryHref={PAGE}
        back={{ href: STUDENTS_PAGE, label: 'Back to your students' }}
      />
    );
  }
  const outcome = await readFormResult(LADDER_FORM, query.outcome);
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[44rem]">
        <p className="eyebrow">
          <Link href={STUDENTS_PAGE} className="link inline-flex min-h-11 items-center">
            Your students
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your rank ladder</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Write your school’s ranks once. Wherever you record a rank or a grading, they are offered as a list to pick from, and you can still write another.
        </p>
        <div className="mt-8">
          <LadderForm steps={view.ladder} initial={outcome} />
        </div>
      </div>
    </div>
  );
}
