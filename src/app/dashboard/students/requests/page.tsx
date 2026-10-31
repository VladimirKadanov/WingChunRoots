// /dashboard/students/requests (milestone M09, In scope 3, 6 and 7; plan §5.6): the teacher's side
// of teacher requests. A table of the requests that wait for this teacher, oldest first, each with
// "Approve" and "Decline…" (a neutral reason), through relationships.approve and
// relationships.reject; under it the confirmed students, current before historical, with "Mark
// training as ended". Each request is answered on its own: approving one confirms no other.
//
// At a real limit, where a request waits because of it, the upgrade prompt stands above the table
// (plan §5.6, DEFAULT D06); the requests stay pending and visible. A refused approval (the limit, a
// cycle, a request withdrawn in the meantime) says why in its row. After a change the page says
// what happened (?approved=, ?declined=, ?ended= with the relationship's id).
//
// The data comes from relationships.incoming, the procedure /api/v1 serves. Reads the session, so
// the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM, UPGRADE_SUMMARY_ID } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { ApproveForm, DeclineForm, EndTrainingForm } from '@/components/relationships/forms';
import { OutcomeNote, PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { REJECTION_REASON_CODES, REJECTION_REASONS } from '@/server/templates/relationships';
import { requestPilotAccessAction } from '../../actions';
import { endTrainingAction } from '../../teachers/actions';
import { END_FORM, endForm } from '../../teachers/form-ids';
import { approveRequestAction, rejectRequestAction } from './actions';
import { APPROVE_FORM, approveForm, REJECT_FORM, rejectForm } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Student requests',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/students/requests';

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

const REASONS = REJECTION_REASON_CODES.map((code) => ({ value: code, label: REJECTION_REASONS[code] }));

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

// The table keeps its semantics at every width: on a phone its rows are drawn as cards, so each
// element keeps an explicit role (a table drawn with display: block loses it in WebKit).
const cell = 'block py-1 sm:table-cell sm:py-4 sm:pr-6 sm:align-top';

export default async function StudentRequestsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const incoming = await pageRead(serverClient(await headers(), guard.principal).relationships.incoming());
  if (!incoming) return <LoadError {...LOAD_ERRORS.studentRequests} retryHref={PAGE} />;
  const [approveResult, rejectResult, endResult, pilotOutcome] = await Promise.all([
    readFormResult(APPROVE_FORM, query.outcome),
    readFormResult(REJECT_FORM, query.outcome),
    readFormResult(END_FORM, query.outcome),
    readFormResult('pilot-access', query.outcome),
  ]);
  const { allowance } = incoming;
  const approved = incoming.students.find((view) => view.id === one(query.approved));
  const ended = incoming.students.find((view) => view.id === one(query.ended));
  const declined = one(query.declined);
  // A refusal at the limit links to what a higher plan adds (M09 review, screens-6): this page with
  // the prompt open at its summary, or the plans page once the account has asked for pilot access
  // (the prompt then lists no benefits).
  const upgradeHref =
    incoming.upgrade && !incoming.upgrade.pilotRequest ? `${PAGE}?${UPGRADE_OPEN_PARAM.name}=${UPGRADE_OPEN_PARAM.value}#${UPGRADE_SUMMARY_ID}` : '/plans';
  const allowanceText =
    allowance.limit === null ? `${allowance.approved} approved, no limit on ${allowance.planName}` : `${allowance.approved} of ${allowance.limit} approved on ${allowance.planName}`;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[60rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Student requests</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Students who name you as their teacher ask you to confirm it. Approve a request and the link is shown publicly on both profiles; decline it
          with a reason and the student can correct it and send it again. You never edit a request yourself.
        </p>
        <p data-testid="student-allowance" className="mt-3 text-sm text-fg-muted">
          Students: {allowanceText}
        </p>

        <div className="mt-8 grid gap-10">
          {approved ? (
            <OutcomeNote testId="request-approved">
              You confirmed <NameText name={approved.student.name} /> as your student. The link is now shown publicly, and both of you got a notification
              and an e-mail.
            </OutcomeNote>
          ) : null}
          {declined && !incoming.requests.some((view) => view.id === declined) ? (
            <OutcomeNote testId="request-declined">
              The request was declined. The student was told the reason and can correct the request and send it again.
            </OutcomeNote>
          ) : null}
          {ended ? (
            <OutcomeNote testId="training-ended">
              Training with <NameText name={ended.student.name} /> is marked as ended. The link stays on both profiles, shown as historical.
            </OutcomeNote>
          ) : null}

          {incoming.accountType === 'student' && incoming.requests.length > 0 ? (
            <p data-testid="student-account-note" className="max-w-[60ch] rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui">
              Your account is a Student account, which approves no students. To answer these requests, switch to Sifu in{' '}
              <Link href="/dashboard/settings" className="link">
                Account type and plan
              </Link>
              ; your confirmed links never change.
            </p>
          ) : null}

          <Section id="requests" title="Waiting for your answer">
            {incoming.upgrade ? (
              <UpgradePrompt
                offer={incoming.upgrade}
                requestAction={requestPilotAccessAction}
                notNowAction={PAGE}
                closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
                expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
                initial={pilotOutcome}
              />
            ) : null}
            {incoming.requests.length === 0 ? (
              <Empty testId="empty-student-requests">
                {incoming.hasProfile
                  ? 'No student requests waiting. Students find you by your name and send you a request; it appears here, and you get a notification and an e-mail.'
                  : 'Student requests appear here once your profile is set up, so your students can find you by your name.'}
              </Empty>
            ) : (
              <table role="table" data-testid="student-requests" className="block w-full text-left sm:table">
                <caption className="sr-only">Requests waiting for your answer, oldest first</caption>
                <thead role="rowgroup" className="sr-only sm:not-sr-only sm:table-header-group">
                  <tr role="row" className="text-sm text-fg-muted">
                    <th role="columnheader" scope="col" className="pb-2 font-semibold sm:pr-6">
                      Student
                    </th>
                    <th role="columnheader" scope="col" className="pb-2 font-semibold sm:pr-6">
                      Training
                    </th>
                    <th role="columnheader" scope="col" className="pb-2 font-semibold">
                      Your answer
                    </th>
                  </tr>
                </thead>
                <tbody role="rowgroup" className="block sm:table-row-group">
                  {incoming.requests.map((view) => {
                    const who = view.student.name.value;
                    return (
                      <tr
                        key={view.id}
                        role="row"
                        data-testid="student-request"
                        data-relationship={view.id}
                        className="grid border-t border-border-subtle py-3 sm:table-row sm:py-0"
                      >
                        <td role="cell" className={cell}>
                          <span className="grid gap-0.5">
                            <PersonName person={view.student} />
                            <span className="text-sm text-fg-muted">Sent {formatDay(view.createdAt)}</span>
                            <span className="mt-1">
                              {/* The teacher's side of "Waiting for the teacher", as on the dashboard. */}
                              <StatusBadge state="unconfirmed" label="Sent to you" />
                            </span>
                          </span>
                        </td>
                        <td role="cell" className={`${cell} text-sm`}>
                          <span className="grid gap-1">
                            <span className="text-fg-muted">{view.lineage.name}</span>
                            <PeriodLines periods={view.periods} />
                          </span>
                        </td>
                        <td role="cell" className={`${cell} sm:pr-0`}>
                          <div className="grid gap-1 sm:min-w-56">
                            {view.can.approve ? (
                              <ApproveForm
                                action={approveRequestAction}
                                relationshipId={view.id}
                                idempotencyKey={randomUUID()}
                                who={who}
                                fixedId={approveForm(view.id)}
                                upgradeHref={upgradeHref}
                                initial={approveResult?.values?.relationshipId === view.id ? approveResult : null}
                              />
                            ) : null}
                            {view.can.reject ? (
                              <DeclineForm
                                action={rejectRequestAction}
                                relationshipId={view.id}
                                idempotencyKey={randomUUID()}
                                who={who}
                                reasons={REASONS}
                                fixedId={rejectForm(view.id)}
                                initial={rejectResult?.values?.relationshipId === view.id ? rejectResult : null}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Section>

          <Section id="students" title="Your students">
            {incoming.students.length === 0 ? (
              <Empty testId="empty-students">No confirmed students yet. A student you approve appears here, and on your public profile.</Empty>
            ) : (
              <ul data-testid="students" className="grid">
                {incoming.students.map((view) => (
                  <li
                    key={view.id}
                    data-testid="student"
                    data-relationship={view.id}
                    className="grid gap-2 border-b border-border-subtle py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-6"
                  >
                    <div className="grid content-start gap-1">
                      <PersonName person={view.student} link />
                      <span className="text-sm text-fg-muted">{view.lineage.name}</span>
                      <div className="text-sm">
                        <PeriodLines periods={view.periods} />
                      </div>
                    </div>
                    <div className="grid content-start justify-items-start gap-2 sm:justify-items-end">
                      <RelationshipBadge view={view} />
                      {view.can.end ? (
                        <EndTrainingForm
                          action={endTrainingAction}
                          relationshipId={view.id}
                          idempotencyKey={randomUUID()}
                          who={view.student.name.value}
                          page="students"
                          fixedId={endForm(view.id)}
                          initial={endResult?.values?.relationshipId === view.id ? endResult : null}
                        />
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
