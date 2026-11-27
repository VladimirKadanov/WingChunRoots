// /dashboard/vouches/<id> (ADR 0088, decision 6): a member who says a profile is theirs asks a
// verified teacher or a verified member to confirm who they are, for the administrators who decide
// an impersonation report. The asked person reads the profile and the asking member's message, and
// answers once. Anyone else gets "No such question". The data comes from identityVouches.get. Reads
// the session, so the page renders per request.

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
import { VOUCH_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Someone asks you to vouch for them',
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

export default async function VouchPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const query = await searchParams;
  const path = UUID.test(id) ? `/dashboard/vouches/${id}` : '/dashboard';
  const guard = await guardRoute('/dashboard', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const read = UUID.test(id) ? await pageRead(orMissing(serverClient(await headers(), guard.principal).identityVouches.get({ id }))) : 'missing';
  if (!read || read === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such question</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This question does not exist, or it was not sent to you.</p>
      </Frame>
    );
  }
  const v = read;
  const initial = await readFormResult(VOUCH_FORM, query.outcome);
  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">Someone asks you to vouch for them</h1>
      <p className="mt-3 text-ui text-fg-muted">
        Asked {formatDay(v.askedAt)} · as a {v.kindLabel.toLowerCase()}
      </p>
      <div className="mt-6 grid gap-6">
        <section aria-labelledby="profile-heading" className="grid gap-3">
          <h2 id="profile-heading" className="font-display text-2xl">
            The profile
          </h2>
          <PersonName person={v.subject} />
          <p className="max-w-[60ch]">
            Two accounts say this profile is theirs. A member who wrote to you below asks you to confirm to the WingChunRoots administrators that they are this person. Answer only from what you know;
            if you are not sure, say so. Only the administrators read your answer and your note.
          </p>
        </section>
        <section aria-labelledby="message-heading" className="grid gap-2">
          <h2 id="message-heading" className="text-sm font-semibold">
            Their message to you
          </h2>
          <p className="max-w-[60ch] whitespace-pre-line rounded-sm bg-surface-2 px-4 py-3" data-testid="vouch-message">
            {v.message ?? 'They wrote no message. If you do not know who asked, answer “I am not sure”.'}
          </p>
        </section>
        {query.answered ? <OutcomeNote testId="vouch-outcome">Thank you. The administrators have your answer.</OutcomeNote> : null}
        {v.answer ? (
          <p className="text-ui" data-testid="vouch-answered" data-answer={v.answer}>
            <span className="font-semibold">You answered: {v.answerLabel}</span> <span className="text-fg-muted">({formatDay(v.answeredAt!)})</span>
            {v.note ? <span className="mt-1 block whitespace-pre-line text-fg-muted">{v.note}</span> : null}
          </p>
        ) : v.open ? (
          <AnswerForm id={v.id} answers={v.answers} noteMax={v.noteMax} initial={initial} />
        ) : (
          <p className="max-w-[56ch] text-fg-muted" data-testid="vouch-closed">
            The administrators have closed this report, so it takes no answer now. Thank you all the same.
          </p>
        )}
      </div>
    </Frame>
  );
}
