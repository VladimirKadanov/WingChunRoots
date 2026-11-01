// /dashboard/teachers (milestone M09, In scope 1, 6 and 7; plan §5.6): the student's side of
// teacher requests. "Requests" lists what waits for a teacher and what a teacher declined, with
// Withdraw and "Correct and send again"; "Teachers" lists the confirmed links, current before
// historical, with "Mark training as ended". Several teachers are independent: each row is its
// own request with its own answer.
//
// M10a: a historical teacher claim (committee_review) waits here too, under review, with its
// evidence, the reviewers' questions and, while it waits, a field to add more files; ?claimed=<id>
// says it was sent. "Name a historical teacher" opens its form.
//
// After a change the page says what happened (?sent=, ?withdrawn=, ?ended= with the relationship's
// id, never a name in the address). The data comes from relationships.mine, the procedure /api/v1
// serves. Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { ArrowRightIcon } from '@/components/icons';
import { EvidenceUploader, formatSize } from '@/components/evidence/uploader';
import { EndTrainingForm, WithdrawForm } from '@/components/relationships/forms';
import { OutcomeNote, PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { RelationshipView } from '@/server/services/relationships';
import { endTrainingAction, withdrawRequestAction } from '../actions';
import { END_FORM, endForm, WITHDRAW_FORM, withdrawForm } from '../form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your teachers',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/teachers';
const NEW = '/dashboard/teachers/new';

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-3 border-t border-border-subtle pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-heading`} className="font-display text-2xl">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Empty({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui text-fg-muted">
      {children}
    </p>
  );
}

/**
 * M10a: the review of a historical teacher claim, as its student sees it: the status in words, the
 * evidence (each file opens through the app's own address, /api/evidence/<id>), the reviewers'
 * questions and reason, and while the claim waits, a field to add more files to it.
 */
function ClaimReview({ review }: { review: NonNullable<RelationshipView['review']> }) {
  return (
    <div data-testid="claim-review" data-case-status={review.status} className="grid gap-3 rounded-sm bg-surface-2 px-4 py-3 sm:col-span-2">
      <p className="text-sm font-semibold">{review.statusLabel}</p>
      {review.decision ? (
        <div data-testid="claim-decision" className="grid gap-1 text-sm">
          <p>{review.decision.text}</p>
          {review.decision.reason ? <p className="whitespace-pre-line text-fg-muted">Reviewers: {review.decision.reason}</p> : null}
        </div>
      ) : null}
      {review.messages.length > 0 ? (
        <ul className="grid gap-2 text-sm" data-testid="claim-messages">
          {review.messages.map((message, i) => (
            <li key={i} className="grid gap-0.5">
              <span className="font-semibold">{message.fromClaimant ? 'Your note' : 'The reviewers ask'}</span>
              <span className="whitespace-pre-line">{message.body}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="grid gap-1">
        <p className="text-sm font-semibold">Evidence</p>
        <ul className="grid gap-1 text-sm" data-testid="claim-files">
          {review.files.map((file) => (
            <li key={file.id}>
              {file.href ? (
                <a href={file.href} className="link inline-flex min-h-11 items-center" translate="no">
                  {file.name ?? `${file.kindLabel} file`}
                </a>
              ) : (
                <span translate="no">{file.name ?? `${file.kindLabel} file`}</span>
              )}{' '}
              <span className="text-fg-muted">
                · {file.kindLabel} · {formatSize(file.sizeBytes)}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {review.canAddFiles ? (
        <EvidenceUploader caseId={review.caseId} label="Add evidence to this claim" hint="JPEG, PNG, WebP or PDF, up to 20 MB each. A file added to a claim stays with it." />
      ) : null}
    </div>
  );
}

function Row({ view, children, testId }: { view: RelationshipView; children?: ReactNode; testId: string }) {
  return (
    <li
      data-testid={testId}
      data-relationship={view.id}
      data-status={view.status}
      className="grid gap-2 border-b border-border-subtle py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6"
    >
      <div className="grid content-start gap-1">
        <PersonName person={view.teacher} link={view.status === 'verified' || view.status === 'in_arbitration'} />
        <span className="text-sm text-fg-muted">{view.lineage.name}</span>
        <div className="text-sm">
          <PeriodLines periods={view.periods} />
        </div>
      </div>
      <div className="grid content-start justify-items-start gap-2 sm:justify-items-end">
        <RelationshipBadge view={view} />
        {children}
      </div>
      {view.review ? <ClaimReview review={view.review} /> : null}
    </li>
  );
}

export default async function TeachersPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const mine = await pageRead(serverClient(await headers(), guard.principal).relationships.mine());
  if (!mine) return <LoadError {...LOAD_ERRORS.teachers} retryHref={PAGE} />;
  const withdrawResult = await readFormResult(WITHDRAW_FORM, query.outcome);
  const endResult = await readFormResult(END_FORM, query.outcome);
  const all = [...mine.requests, ...mine.teachers];
  const byId = (id: string) => all.find((view) => view.id === id);
  const sent = byId(one(query.sent));
  const claimed = byId(one(query.claimed));
  const ended = byId(one(query.ended));
  const withdrawn = one(query.withdrawn);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your teachers</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Each teacher confirms their own link to you. A request waits here until that teacher answers; only the two of you and the reviewers see it
          until then.
        </p>
        {mine.hasProfile ? (
          <p className="mt-5 flex flex-wrap gap-3">
            <Link href={NEW} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Name a teacher
              <ArrowRightIcon />
            </Link>
            <Link href="/dashboard/teachers/historical" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
              Name a historical teacher
            </Link>
          </p>
        ) : null}

        <div className="mt-8 grid gap-10">
          {sent ? (
            <OutcomeNote testId="request-sent">
              {sent.status === 'pending_teacher' ? (
                <>
                  Your request was sent to <NameText name={sent.teacher.name} />. It waits below until they answer, and they get a notification and an
                  e-mail.
                </>
              ) : (
                <>
                  Your request to <NameText name={sent.teacher.name} /> is {sent.statusLabel.toLowerCase()}.
                </>
              )}
            </OutcomeNote>
          ) : null}
          {claimed ? (
            <OutcomeNote testId="claim-sent">
              Your claim about <NameText name={claimed.teacher.name} /> was sent with its evidence. Reviewers check it; it waits below until they decide,
              and you get a notification and an e-mail.
            </OutcomeNote>
          ) : null}
          {withdrawn && !byId(withdrawn) ? (
            <OutcomeNote testId="request-withdrawn">
              The request was withdrawn. Nothing about it is shown to anyone; you can send a new one at any time.
            </OutcomeNote>
          ) : null}
          {ended ? (
            <OutcomeNote testId="training-ended">
              Training with <NameText name={ended.teacher.name} /> is marked as ended. The link stays on both profiles, shown as historical.
            </OutcomeNote>
          ) : null}

          {!mine.hasProfile ? (
            <div className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">Your profile is not set up yet. A teacher confirms you by your name, so add it first.</p>
              <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Set up your profile
                <ArrowRightIcon />
              </Link>
            </div>
          ) : null}

          <Section id="requests" title="Requests">
            {mine.requests.length === 0 ? (
              <Empty testId="empty-requests">
                {mine.hasProfile ? 'No open requests. A request you send waits here until the teacher answers it.' : 'No requests yet.'}
              </Empty>
            ) : (
              <ul data-testid="requests" className="grid">
                {mine.requests.map((view) => {
                  const who = view.teacher.name.value;
                  const withdrawInitial = withdrawResult?.values?.relationshipId === view.id ? withdrawResult : null;
                  return (
                    <Row key={view.id} view={view} testId="request">
                      <span className="text-sm text-fg-muted">Sent {formatDay(view.createdAt)}</span>
                      {view.rejection ? (
                        <p data-testid="rejection" className="max-w-[34ch] text-sm sm:text-right">
                          {view.rejection.text}
                        </p>
                      ) : null}
                      {view.can.resubmit ? (
                        <Link href={`${NEW}?resubmit=${view.id}`} className={buttonVariants({ variant: 'secondary' })}>
                          Correct and send again<span className="sr-only"> ({who})</span>
                        </Link>
                      ) : null}
                      {view.can.withdraw ? (
                        <WithdrawForm
                          action={withdrawRequestAction}
                          relationshipId={view.id}
                          idempotencyKey={randomUUID()}
                          who={who}
                          fixedId={withdrawForm(view.id)}
                          initial={withdrawInitial}
                        />
                      ) : null}
                    </Row>
                  );
                })}
              </ul>
            )}
          </Section>

          <Section id="teachers" title="Teachers">
            {mine.teachers.length === 0 ? (
              <Empty testId="empty-teachers">
                {mine.hasProfile
                  ? 'No confirmed teachers yet. When a teacher confirms your request, they appear here with their seal.'
                  : 'Your teachers appear here once your profile is set up and a teacher confirms you.'}
              </Empty>
            ) : (
              <ul data-testid="teachers" className="grid">
                {mine.teachers.map((view) => (
                  <Row key={view.id} view={view} testId="teacher">
                    {view.confirmedAt ? <span className="text-sm text-fg-muted">Confirmed {formatDay(view.confirmedAt)}</span> : null}
                    {view.can.end ? (
                      <EndTrainingForm
                        action={endTrainingAction}
                        relationshipId={view.id}
                        idempotencyKey={randomUUID()}
                        who={view.teacher.name.value}
                        page="teachers"
                        fixedId={endForm(view.id)}
                        initial={endResult?.values?.relationshipId === view.id ? endResult : null}
                      />
                    ) : null}
                  </Row>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
