// /dashboard/naming (review 2026-11-13, docs/adr/0088-review-1113-leftovers.md): the requests to
// list the account (its person, an organization it administers, its address) as a member, an
// instructor, an examiner, an issuer or an administrator. Nothing is attached before the account
// accepts. The data comes from naming.mine. Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { NamingAnswer } from './answer-form';
import { namingForm } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Requests to name you',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const OUTCOMES: Record<string, string> = {
  accepted: 'Accepted. You are listed now.',
  declined: 'Declined. Nothing was listed, and the request is gone.',
};

export default async function NamingPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const guard = await guardRoute('/dashboard', '/dashboard/naming');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const read = await pageRead(serverClient(await headers(), guard.principal).naming.mine());
  if (!read) return null;
  const answered = typeof query.answered === 'string' ? OUTCOMES[query.answered] : undefined;
  const initials = await Promise.all(read.requests.map((r) => readFormResult(namingForm(r.id), query.outcome)));
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Requests to name you</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          Nobody lists you as a member of an organization, an instructor at an event, the examiner of a grading, an organization’s administrator, or your organization as the issuer
          of a rank, without your agreement. Accept to be listed; decline and nothing changes.
        </p>
        <section id="requests" aria-labelledby="requests-heading" className="mt-8 grid scroll-mt-24 gap-4">
          <h2 id="requests-heading" className="font-display text-2xl">
            Waiting for your answer
          </h2>
          {answered ? <OutcomeNote testId="naming-outcome">{answered}</OutcomeNote> : null}
          {read.requests.length === 0 ? (
            <p className="text-fg-muted" data-testid="naming-none">
              Nothing waits for you.
            </p>
          ) : (
            <ul className="grid gap-5">
              {read.requests.map((r, i) => (
                <li key={r.id} className="grid gap-3 border-t border-border-subtle pt-4" data-testid="naming-request" data-kind={r.kind}>
                  <div className="grid gap-1">
                    <p className="font-semibold">{r.kindLabel}</p>
                    <p className="text-ui">
                      {r.about}
                      {r.named ? <span className="text-fg-muted"> · {r.named}</span> : null}
                    </p>
                    <p className="text-sm text-fg-muted">Asked {formatDay(r.createdAt)}</p>
                  </div>
                  <NamingAnswer id={r.id} context={`${r.kindLabel}, ${r.about}`} initial={initials[i] ?? null} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
