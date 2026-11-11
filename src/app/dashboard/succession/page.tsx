// /dashboard/succession (milestone M25, In scope 1; specification §15): the digital successor.
// The owner nominates one verified student (who holds Premium Student or Professional Sifu,
// DEFAULT M25 question 2), sees the nomination's status in words and can revoke it at any time;
// the nominee accepts or declines; an accepted successor may ask to take over the administration
// only after a reported death or more than 180 days without activity on the owner's account, and
// always with evidence for an administrator's review. Inactivity alone never transfers anything and
// never marks anyone deceased. The data comes from succession.mine. Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ANSWER_FORM, NOMINATE_FORM, REQUEST_FORM, REVOKE_FORM } from './form-ids';
import { AnswerForm, NominateForm, RevokeForm, SuccessionRequestForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Digital successor',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/succession';

function Section({ id, title, children, testId }: { id: string; title: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-border-subtle pt-6" data-testid={testId}>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Status({ label, value, testId }: { label: string; value: string; testId?: string }) {
  // The status in words (never by colour alone).
  return (
    <p className="text-sm" data-testid={testId} data-status={value}>
      <span className="text-fg-muted">Status: </span>
      <span className="font-semibold">{label}</span>
    </p>
  );
}

function Note({ testId, children }: { testId: string; children: ReactNode }) {
  return (
    <p data-testid={testId} className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui">
      {children}
    </p>
  );
}

export default async function SuccessionPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const view = await pageRead(serverClient(await headers(), guard.principal).succession.mine());
  if (!view) return <LoadError {...REVIEW_LOAD_ERRORS.succession} retryHref={PAGE} />;
  const [nominateInitial, answerInitial, revokeInitial, requestInitial] = await Promise.all([
    readFormResult(NOMINATE_FORM, query.outcome),
    readFormResult(ANSWER_FORM, query.outcome),
    readFormResult(REVOKE_FORM, query.outcome),
    readFormResult(REQUEST_FORM, query.outcome),
  ]);
  const eligible = view.candidates.filter((c) => c.eligible);
  const ineligible = view.candidates.filter((c) => !c.eligible);
  const n = view.nomination;
  const requested = typeof query.requested === 'string' ? view.myRequests.find((r) => r.caseId === query.requested) : undefined;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Digital successor</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          You can name one of your verified students to look after your schools and organizations if you can no longer do it. Nothing moves to them
          by itself: they can ask only after a reported death or more than {view.inactivityDays} days without any activity on your account, and an
          administrator checks their evidence first. Inactivity alone never marks anyone as deceased. Your teaching history stays exactly as it is.
        </p>

        <div className="mt-8 grid gap-8">
          {query.nominated === '1' && n ? <OutcomeNote testId="succession-nominated">Your nomination was sent. They are asked to accept or decline it.</OutcomeNote> : null}
          {query.revoked === '1' ? <OutcomeNote testId="succession-revoked">The nomination was revoked. Any request they had sent was closed.</OutcomeNote> : null}
          {query.answered === 'accepted' ? <OutcomeNote testId="succession-accepted">You accepted the nomination. Nothing changes until a request is reviewed.</OutcomeNote> : null}
          {query.answered === 'declined' ? <OutcomeNote testId="succession-declined">You declined the nomination.</OutcomeNote> : null}
          {requested ? (
            <OutcomeNote testId="succession-requested">
              Your request was sent to the administrators with its evidence. The owner was told. You get a notification when it is decided.
            </OutcomeNote>
          ) : null}

          <Section id="succession-own" title="Your successor" testId="succession-own">
            {!view.hasProfile ? (
              <Note testId="succession-no-profile">
                A successor is chosen among the verified students of your profile. Create{' '}
                <Link href="/dashboard/profile" className="link">
                  your profile
                </Link>{' '}
                first.
              </Note>
            ) : !view.entitled ? (
              <Note testId="succession-entitlement">
                {view.entitlementNote}{' '}
                <Link href="/plans" className="link">
                  See the plans
                </Link>
              </Note>
            ) : n ? (
              <div className="grid gap-3" data-testid="succession-nomination" data-status={n.status}>
                {n.successor ? <PersonName person={n.successor} link /> : null}
                <Status label={n.statusLabel} value={n.status} testId="succession-nomination-status" />
                <p className="text-sm text-fg-muted">Nominated on {formatDay(n.createdAt)}.</p>
                <RevokeForm nominationId={n.id} who={n.successor?.name.value ?? 'your successor'} initial={revokeInitial} />
              </div>
            ) : view.candidates.length === 0 ? (
              <Note testId="succession-no-candidates">You have no verified students with an account yet. A successor is chosen among them.</Note>
            ) : (
              <>
                {eligible.length > 0 ? (
                  <NominateForm candidates={eligible.map((c) => ({ id: c.person.id, name: c.person.name.value }))} initial={nominateInitial} />
                ) : null}
                {ineligible.length > 0 ? (
                  <div className="grid gap-1 text-sm" data-testid="succession-ineligible">
                    <p className="text-fg-muted">These verified students can be nominated once they hold Premium Student or Professional Sifu:</p>
                    <ul className="grid gap-1">
                      {ineligible.map((c) => (
                        <li key={c.person.id}>
                          <PersonName person={c.person} className="text-sm" />
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
            {view.requestsAboutMe.length > 0 ? (
              <div className="grid gap-2" data-testid="succession-about-me">
                <h3 className="font-semibold">Requests about your account</h3>
                <p className="max-w-[60ch] text-sm text-fg-muted">
                  You can stop a waiting request by revoking the nomination. An administrator reviews every request before
                  anything changes.
                </p>
                <ul className="grid gap-2 text-sm">
                  {view.requestsAboutMe.map((r) => (
                    <li key={r.id} data-status={r.status}>
                      {formatDay(r.createdAt)} · {r.basis === 'reported_death' ? 'A reported death' : 'Inactivity'} · <span className="font-semibold">{r.statusLabel}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </Section>

          {view.received.length > 0 ? (
            <Section id="succession-received" title="Nominations you received" testId="succession-received">
              <ul className="grid gap-6">
                {view.received.map((r) => (
                  <li key={r.id} className="grid gap-3" data-testid="succession-received-row" data-status={r.status}>
                    {r.owner ? <PersonName person={r.owner} link /> : null}
                    <Status label={r.statusLabel} value={r.status} />
                    {r.status === 'pending' ? (
                      <>
                        <p className="max-w-[60ch] text-sm text-fg-muted">
                          They named you as their digital successor. Accepting changes nothing now; it lets you ask later, with evidence, if they
                          can no longer look after their schools and organizations.
                        </p>
                        <AnswerForm nominationId={r.id} who={r.owner?.name.value ?? 'the owner'} initial={answerInitial} />
                      </>
                    ) : null}
                    {r.mayRequest ? (
                      <details className="grid gap-4" open={Boolean(requestInitial)}>
                        <summary className="link inline-flex min-h-11 cursor-pointer items-center">Ask to take over the administration</summary>
                        <div className="mt-4">
                          <SuccessionRequestForm
                            nominationId={r.id}
                            inactivityOpen={r.inactivityOpen}
                            inactivityDays={view.inactivityDays}
                            idempotencyKey={randomUUID()}
                            initial={requestInitial}
                          />
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {view.myRequests.length > 0 ? (
            <Section id="succession-mine" title="Your requests" testId="succession-my-requests">
              <ul className="grid gap-2 text-sm">
                {view.myRequests.map((r) => (
                  <li key={r.id} data-status={r.status}>
                    {formatDay(r.createdAt)} · {r.basis === 'reported_death' ? 'A reported death' : 'Inactivity'} · <span className="font-semibold">{r.statusLabel}</span> ·{' '}
                    <Link href={`/dashboard/cases/${r.caseId}`} className="link inline-flex min-h-11 items-center">
                      Open the case
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}

          {view.pastNominations.length > 0 ? (
            <Section id="succession-past" title="Earlier nominations">
              <ul className="grid gap-2 text-sm">
                {view.pastNominations.map((p) => (
                  <li key={p.id} data-status={p.status}>
                    {p.successor ? <PersonName person={p.successor} className="text-sm" /> : null} · {formatDay(p.createdAt)} · <span className="font-semibold">{p.statusLabel}</span>
                  </li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
