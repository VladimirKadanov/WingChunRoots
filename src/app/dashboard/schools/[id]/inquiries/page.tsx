// /dashboard/schools/[id]/inquiries (M21, docs/adr/0024-trial-lessons.md): the trial lesson requests
// of one school (trial.inbox), for its listing account and the admins of an organization it is
// linked to. Open requests first; a filter by state, each with its count. Each request shows the
// sender's profile name, the contact they chose, their times and message, and its state in words
// with a mark. Answer, Decline and Close are thin Server Actions (trial.answer, trial.decline,
// trial.close). Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { TRIAL_INBOX_LOAD_ERROR } from '@/components/account/load-errors/trial-lessons';
import { PageRedirect } from '@/components/account/page-redirect';
import { TrialStatusTag } from '@/components/schools/trial-status';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { trialForm } from '../../form-ids';
import { EditorShell, SchoolNotFound } from '../../parts';
import { InquiryActions } from './inquiry-actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Trial lesson requests',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTERS = [
  ['all', 'All'],
  ['open', 'Waiting'],
  ['answered', 'Answered'],
  ['declined', 'Declined'],
  ['closed', 'Closed'],
  ['withdrawn', 'Withdrawn'],
] as const;
type Filter = (typeof FILTERS)[number][0];

const DONE: Record<string, string> = {
  answered: 'The request is answered. They are told, with your reply.',
  declined: 'The request is declined. They are told, with your reason if you gave one.',
  closed: 'The request is closed.',
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TrialInboxPage({ params, searchParams }: Props) {
  const { id } = await params;
  const valid = UUID.test(id);
  const page = `/dashboard/schools/${valid ? id : ''}`;
  const inbox = `${page}/inquiries`;
  const guard = await guardRoute(valid ? inbox : page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!valid) return <SchoolNotFound />;
  const query = await searchParams;
  const status: Filter = FILTERS.some(([f]) => f === query.status) ? (query.status as Filter) : 'all';
  const { missing, value: view } = await pageReadOne(serverClient(await headers(), guard.principal) .trial.inbox({ schoolId: id, status }));
  if (missing) return <SchoolNotFound />;
  if (!view) return <LoadError {...TRIAL_INBOX_LOAD_ERROR} retryHref={inbox} />;
  const rows = await Promise.all(view.inquiries.map(async (q) => ({ ...q, initial: await readFormResult(trialForm(q.id), query.outcome) })));
  const total = view.counts.open + view.counts.answered + view.counts.declined + view.counts.closed + view.counts.withdrawn;
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;

  return (
    <EditorShell
      title={`Trial lesson requests of ${view.school.name}`}
      lead={
        <>
          People who asked {view.school.name} for a trial lesson. You see their profile name and the contact they chose; use it only to answer
          them. A sender can withdraw a request, and one that nobody answers is closed after 90 days: both lose the name, contact and message. Closed
          requests are deleted after a year.{' '}
          {view.role === 'owner' ? (
            <Link href={page} className="link inline-flex min-h-11 items-center">
              Back to the listing
            </Link>
          ) : null}
        </>
      }
    >
      {done ? (
        <p id="outcome" role="status" tabIndex={-1} className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="trial-done">
          {done}
        </p>
      ) : null}
      <nav aria-label="Filter the requests" className="flex flex-wrap gap-2" data-testid="trial-filters">
        {FILTERS.map(([f, label]) => {
          const n = f === 'all' ? total : view.counts[f];
          return (
            <Link
              key={f}
              href={f === 'all' ? inbox : `${inbox}?status=${f}`}
              aria-current={status === f ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 items-center rounded-sm border px-3 text-sm',
                status === f ? 'border-fg font-semibold underline underline-offset-4' : 'border-border-subtle',
              )}
            >
              {label} ({n})
            </Link>
          );
        })}
      </nav>
      {rows.length === 0 ? (
        <p className="text-ui text-fg-muted" data-testid="no-trial-inquiries">
          {total === 0 ? 'No one has asked for a trial lesson yet.' : 'No request is in this state.'}
        </p>
      ) : (
        <ul className="grid" data-testid="trial-inquiries">
          {rows.map((q) => (
            <li key={q.id} className="grid gap-2 border-b border-border-subtle py-5" data-testid="trial-inquiry" data-status={q.status}>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {q.senderName ? (
                  <span className="font-display text-lg [overflow-wrap:anywhere]" translate="no">
                    {q.senderName}
                  </span>
                ) : (
                  <span className="font-display text-lg text-fg-muted">Name removed</span>
                )}
                <TrialStatusTag status={q.status} label={q.statusLabel} />
              </p>
              <p className="text-sm text-fg-muted">
                Sent {formatDay(q.createdAt)}
                {q.closedAt ? ` · ${q.statusLabel.toLowerCase()} ${formatDay(q.closedAt)}` : ''}
              </p>
              {q.contactValue ? (
                <p className="text-sm">
                  {q.contactMethod === 'phone' ? 'Phone: ' : 'E-mail: '}
                  <a
                    href={q.contactMethod === 'phone' ? `tel:${q.contactValue.replace(/[^\d+]/g, '')}` : `mailto:${q.contactValue}`}
                    className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]"
                    data-testid="trial-contact"
                  >
                    {q.contactValue}
                  </a>
                </p>
              ) : (
                <p className="text-sm text-fg-muted" data-testid="trial-scrubbed">
                  {q.status === 'withdrawn' ? 'The sender withdrew this request. Their name, contact and message are removed.' : 'Closed without an answer. The sender’s name, contact and message are removed.'}
                </p>
              )}
              {q.preferredTimes ? <p className="text-sm">Times: {q.preferredTimes}</p> : null}
              {q.message ? <p className="whitespace-pre-line [overflow-wrap:anywhere]">{q.message}</p> : null}
              {q.reply ? (
                <div className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm">
                  <p className="font-semibold">{q.status === 'declined' ? 'Your reason' : 'Your reply'}</p>
                  <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]">{q.reply}</p>
                </div>
              ) : null}
              {q.status === 'open' || q.status === 'answered' ? (
                <InquiryActions schoolId={view.school.id} inquiryId={q.id} status={q.status} sender={q.senderName ?? 'the sender'} replyMax={view.limits.reply} initial={q.initial} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </EditorShell>
  );
}
