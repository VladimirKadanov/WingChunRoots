// /dashboard/passport (milestone M19, In scope 7; docs/adr/0022-passport.md): the owner's training
// passport. Every active entry with its visibility and whether the profile shows it on the plan
// (DEFAULT M19, question 3: the basic passport keeps the other entries, never deletes them, D08);
// "Make private" / "Make public", "Propose a correction" (a student never writes a rank, an
// examination or a skill: question 1), and the certificates (question 4: images only, private
// unless chosen public). The upgrade prompt only at the real limit (entries kept but not shown),
// with the benefits of the pilot only (plan §5.6, CLAUDE.md §11). Data from passport.mine; changes
// through thin Server Actions and /api/rpc. Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { EntryLine } from '@/components/passport/passport-view';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { messageId } from '@/lib/form-state';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { MyPassport, OwnPassportEntry } from '@/server/services/passport';
import { requestPilotAccessAction } from '../actions';
import { CertificateUpload, RemoveCertificateButton, VisibilityForm } from './controls';
import { CorrectionForm } from './correction-form';
import { PASSPORT_CORRECTION_FORM, PASSPORT_VISIBILITY_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your training passport',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/passport';
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Who sees the entry, in words and a shape (never colour alone). */
function VisibilityState({ entry, plan }: { entry: OwnPassportEntry; plan: string }) {
  const [text, shape] =
    entry.visibility === 'private'
      ? ['Private: only you and your teachers', <path key="p" d="M4.5 7.5V5.5a3.5 3.5 0 0 1 7 0v2M3.5 7.5h9v6h-9z" />]
      : entry.shownOnProfile
        ? ['Public: shown on your profile', <path key="p" d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6z" />]
        : entry.hiddenByPlan
          ? [`Public, kept: ${plan} shows the basic passport`, <path key="p" d="M2 2l12 12M4 5.5C2.5 6.8 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.3-.4 3.2-1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.3" />]
          : ['Public: shown once your profile is public', <path key="p" d="M8 2.5v7M8 12.5v1" />];
  return (
    <p className="inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="passport-entry-visibility" data-visibility={entry.visibility} data-shown={entry.shownOnProfile}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {shape}
      </svg>
      {text}
    </p>
  );
}

function Summary({ view }: { view: MyPassport }) {
  const current = view.entries.find((e) => e.id === view.currentRankId) ?? null;
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1 rounded-sm border border-border-strong p-4">
        <dt className="eyebrow">Current rank</dt>
        <dd className="font-display text-xl [overflow-wrap:anywhere]">{current ? current.title : 'No rank recorded yet'}</dd>
        {current ? <dd className="text-sm text-fg-muted tabular">{current.dateText}</dd> : null}
      </div>
      <div className="grid gap-1 rounded-sm border border-border-subtle p-4">
        <dt className="eyebrow">Training</dt>
        <dd className="font-display text-xl tabular">{view.experience ? view.experience.text : 'Start not recorded'}</dd>
        <dd className="text-sm text-fg-muted">From your teachers’ periods and the year you began, only as precise as they are.</dd>
      </div>
      {view.teachers.length > 0 ? (
        <div className="grid gap-1 sm:col-span-2">
          <dt className="eyebrow">Teachers</dt>
          {view.teachers.map((t) => (
            <dd key={`${t.person.slug}:${t.lineage}`} className="text-ui">
              <Link href={`/people/${t.person.slug}`} className="link inline-flex min-h-11 items-center">
                <span lang={t.person.name.lang} translate="no">
                  {t.person.name.value}
                </span>
              </Link>{' '}
              <span className="text-sm text-fg-muted tabular">
                · {t.lineage} · {t.periods.map((p) => p.text).join('; ') || 'Dates not recorded'}
              </span>
            </dd>
          ))}
        </div>
      ) : null}
    </dl>
  );
}

export default async function PassportPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  let view: MyPassport | 'no-profile' | null;
  try {
    view = await serverClient(await headers(), guard.principal).passport.mine();
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') view = 'no-profile';
    else if (rpcErrorCode(error) === null || rpcErrorCode(error) === 'INTERNAL_SERVER_ERROR') view = null;
    else throw error;
  }
  if (view === null) {
    return (
      <LoadError
        eyebrow="Dashboard"
        title="Your training passport"
        message="We couldn't load your passport. Nothing was changed."
        retryHref={PAGE}
        back={{ href: '/dashboard', label: 'Back to the dashboard' }}
      />
    );
  }
  const [visibilityOutcome, correctionOutcome] = await Promise.all([
    readFormResult(PASSPORT_VISIBILITY_FORM, query.outcome),
    readFormResult(PASSPORT_CORRECTION_FORM, query.outcome),
  ]);
  const correcting = correctionOutcome?.values?.id ?? one(query.correct) ?? null;
  const notice = query.published === '1' ? 'The entry is public now.' : query.hidden === '1' ? 'The entry is private now: only you and your teachers see it.' : query.corrected === '1' ? 'Your correction was sent to whoever recorded the entry.' : null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your training passport</h1>
        {view === 'no-profile' ? (
          <p className="mt-3 max-w-[60ch] text-ui text-fg-muted" data-testid="passport-no-profile">
            You have no profile yet. Finish setting up your profile first: your passport belongs to it.
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
              Your teachers and the organizations that awarded them record your ranks, examinations, forms and skills, and mark the events you attended. You decide
              what your profile shows, propose a correction, and add scanned certificates.
            </p>
            <p className="mt-3 max-w-[60ch] text-ui" data-testid="passport-level" data-level={view.level}>
              {view.level === 'full'
                ? `On ${view.plan.name} your profile shows the full timeline of your public entries.`
                : `On ${view.plan.name} your profile shows your current rank, your teachers and the year you began. Your other entries are kept.`}
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 text-ui">
              <Link href={`/people/${view.person.slug}#passport-heading`} className="link inline-flex min-h-11 items-center" data-testid="passport-profile-link">
                See your profile
              </Link>
            </p>
            {notice ? (
              <p role="status" className="mt-4 text-ui font-semibold" data-testid="passport-notice">
                {notice}
              </p>
            ) : null}
            {visibilityOutcome?.status === 'error' ? (
              <p id={messageId(PASSPORT_VISIBILITY_FORM)} role="alert" tabIndex={-1} className="mt-4 text-ui text-danger">
                <span className="font-semibold">Not changed:</span> {visibilityOutcome.message}
              </p>
            ) : null}
            {view.upgrade ? (
              <div className="mt-6">
                <UpgradePrompt
                  offer={view.upgrade}
                  requestAction={requestPilotAccessAction}
                  notNowAction={PAGE}
                  closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
                  expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
                />
              </div>
            ) : null}

            <div className="mt-8">
              <Summary view={view} />
            </div>

            <section aria-labelledby="passport-entries" className="mt-10 grid gap-4">
              <h2 id="passport-entries" className="font-display text-2xl">
                Entries
              </h2>
              {view.entries.length === 0 ? (
                <p className="text-fg-muted">Nothing recorded yet. Your teacher records your ranks, examinations and skills from their dashboard.</p>
              ) : (
                <ol className="grid gap-5" aria-label="Your entries, the latest first">
                  {view.entries.map((entry) => (
                    <li key={`${entry.kind}:${entry.id}`} id={`entry-${entry.id}`} className="grid scroll-mt-24 gap-3 border-t border-border-subtle pt-4" data-testid="own-passport-entry" data-kind={entry.kind}>
                      <EntryLine entry={entry}>
                        <VisibilityState entry={entry} plan={view.plan.name} />
                        {entry.correction ? (
                          <p className="text-sm text-fg-muted" data-testid="passport-correction-waiting">
                            Your correction waits for whoever recorded it: “{entry.correction.note}”
                          </p>
                        ) : null}
                      </EntryLine>
                      <div className="flex flex-wrap items-start gap-2">
                        <VisibilityForm kind={entry.kind} id={entry.id} visibility={entry.visibility} initial={visibilityOutcome?.values?.id === entry.id ? visibilityOutcome : null} />
                        {entry.kind === 'rank' || entry.kind === 'exam' || entry.kind === 'skill' ? (
                          correcting === entry.id ? null : (
                            <Link href={`${PAGE}?correct=${entry.id}#entry-${entry.id}`} className="link inline-flex min-h-11 items-center px-2" data-testid="passport-propose-correction">
                              Propose a correction
                            </Link>
                          )
                        ) : null}
                        {entry.kind === 'certificate' ? <RemoveCertificateButton id={entry.id} title={entry.title} /> : null}
                      </div>
                      {correcting === entry.id && (entry.kind === 'rank' || entry.kind === 'exam' || entry.kind === 'skill') ? (
                        <CorrectionForm kind={entry.kind} id={entry.id} initial={correctionOutcome} />
                      ) : null}
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section aria-labelledby="passport-certificates" className="mt-10 grid gap-3">
              <h2 id="passport-certificates" className="font-display text-2xl">
                Add a certificate
              </h2>
              <CertificateUpload count={view.certificates.count} limit={view.certificates.limit} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}
