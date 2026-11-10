// /dashboard/trial-lessons (M21, docs/adr/0024-trial-lessons.md): the trial lesson requests this
// account sent (trial.mine), the newest first, each with its school, its state in words, what was
// sent, and the school's answer or reason. ?sent=1 says a request just went out. Reads the session,
// so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { OWN_TRIAL_LOAD_ERROR } from '@/components/account/load-errors/trial-lessons';
import { PageRedirect } from '@/components/account/page-redirect';
import { TrialStatusTag } from '@/components/schools/trial-status';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your trial lesson requests',
  robots: { index: false },
};

const PAGE = '/dashboard/trial-lessons';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function OwnTrialLessonsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const mine = await pageRead(serverClient(await headers(), guard.principal).trial.mine());
  if (!mine) return <LoadError {...OWN_TRIAL_LOAD_ERROR} retryHref={PAGE} />;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your trial lesson requests</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          The schools you asked for a trial lesson. A school sees your profile name and the contact you chose; its answer shows here and in your
          notifications.
        </p>
        <div className="mt-8 grid gap-6">
          {query.sent === '1' ? (
            <p id="outcome" role="status" tabIndex={-1} className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="trial-sent">
              Your request is sent. The school is told now and answers here.
            </p>
          ) : null}
          {mine.inquiries.length === 0 ? (
            <div className="grid justify-items-start gap-3" data-testid="no-trial-requests">
              <p className="text-ui text-fg-muted">You have not asked a school for a trial lesson yet.</p>
              <Link href="/schools" className={buttonVariants({ variant: 'secondary' })}>
                Find a school
              </Link>
            </div>
          ) : (
            <ul className="grid" data-testid="own-trial-requests">
              {mine.inquiries.map((q) => (
                <li key={q.id} className="grid gap-2 border-b border-border-subtle py-4" data-testid="own-trial-request" data-status={q.status}>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {q.school.public ? (
                      <Link href={`/schools/${q.school.slug}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                        {q.school.name}
                      </Link>
                    ) : (
                      <span className="font-display text-lg [overflow-wrap:anywhere]">{q.school.name}</span>
                    )}
                    <TrialStatusTag status={q.status} label={q.statusLabel} />
                  </p>
                  <p className="text-sm text-fg-muted">
                    Sent {formatDay(q.createdAt)}
                    {q.closedAt ? ` · ${q.status === 'closed' ? 'closed' : q.status} ${formatDay(q.closedAt)}` : ''} · contact by{' '}
                    {q.contactMethod === 'phone' ? 'phone' : 'e-mail'}: <span className="[overflow-wrap:anywhere]">{q.contactValue}</span>
                  </p>
                  {q.preferredTimes ? <p className="text-sm">Times: {q.preferredTimes}</p> : null}
                  {q.message ? <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{q.message}</p> : null}
                  {q.reply ? (
                    <div className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="own-trial-reply">
                      <p className="font-semibold">{q.status === 'declined' ? 'The school’s reason' : 'The school’s answer'}</p>
                      <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{q.reply}</p>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
