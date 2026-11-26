// /dashboard/confirmations/<id> (role replay 2026-11-25, P3-8, docs/adr/0067-ask-teacher-to-confirm.md):
// the reviewers ask a verified teacher whether someone who asked to take over the profile of one of
// their students is that student. The teacher reads the student's name (their own student) and
// nothing of the claimant, and answers once. Anyone else gets "No such question". The data comes
// from claimConfirmations.get. Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { AnswerForm } from './answer-form';
import { CONFIRMATION_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'A question from the reviewers',
  robots: { index: false },
};

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

export default async function ConfirmationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const query = await searchParams;
  const path = UUID.test(id) ? `/dashboard/confirmations/${id}` : '/dashboard';
  const guard = await guardRoute('/dashboard', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const read = UUID.test(id) ? await pageRead(orMissing(serverClient(await headers(), guard.principal).claimConfirmations.get({ id }))) : 'missing';
  if (!read || read === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such question</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This question does not exist, or it was not sent to you.</p>
      </Frame>
    );
  }
  const c = read;
  const initial = await readFormResult(CONFIRMATION_FORM, query.outcome);
  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">A question from the reviewers</h1>
      <p className="mt-3 text-ui text-fg-muted">Asked {formatDay(c.askedAt)}</p>
      <div className="mt-6 grid gap-6">
        <section aria-labelledby="student-heading" className="grid gap-3">
          <h2 id="student-heading" className="font-display text-2xl">
            Your student
          </h2>
          <PersonName person={c.student} />
          <p className="max-w-[60ch]">
            Someone asked to take over this profile, which is listed as your student. The reviewers ask whether you know that it is your student. If you can, ask them; then tell the reviewers
            what you know. Your answer helps them decide, and only they read it. You see nothing about the person who asked, and they do not see your answer.
          </p>
        </section>
        {query.answered ? <OutcomeNote testId="confirmation-outcome">Thank you. The reviewers have your answer.</OutcomeNote> : null}
        {c.answer ? (
          <p className="text-ui" data-testid="confirmation-answered" data-answer={c.answer}>
            <span className="font-semibold">You answered: {c.answerLabel}</span> <span className="text-fg-muted">({formatDay(c.answeredAt!)})</span>
            {c.note ? <span className="mt-1 block whitespace-pre-line text-fg-muted">{c.note}</span> : null}
          </p>
        ) : c.open ? (
          <AnswerForm id={c.id} answers={c.answers} noteMax={c.noteMax} initial={initial} />
        ) : (
          <p className="max-w-[56ch] text-fg-muted" data-testid="confirmation-closed">
            The reviewers have closed this case, so it takes no answer now. Thank you all the same.
          </p>
        )}
      </div>
    </Frame>
  );
}
