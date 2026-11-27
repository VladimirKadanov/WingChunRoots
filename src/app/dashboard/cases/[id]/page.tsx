// /dashboard/cases/<id> (milestone M10b; plan §5.6, DEFAULT D19): one review case of the signed-in
// account: the claim of a profile it was invited to, its instructor verification, or a dispute
// about one of its relationships. The status in words, the reviewers' notes and the account's own
// answers, its own files, the decision and its reason; while the case is open, a field to add
// files (the M10a evidence field, POST /api/evidence/upload?case=<id>) and an answer to the
// reviewers (cases.reply). In a dispute each party reads the reviewers' words and their own, never
// the other party's answers or files. Anyone else gets "No such case". The data comes from
// cases.get. Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { EvidenceUploader } from '@/components/evidence/uploader';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { APPEAL_FORM, CODE_ADD_FORM, CODE_CONFIRM_FORM, REPLY_FORM, VOUCH_ASK_FORM } from './form-ids';
import { AppealForm } from './appeal-form';
import { AddCodeForm, AskVouchForm, ConfirmCodeForm } from './identity-forms';
import { ReplyForm } from './reply-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your case',
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
          <Link href="/dashboard/cases" className="link inline-flex min-h-11 items-center">
            Your cases
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

const DECISION_WORDS: Record<string, Record<'approved' | 'rejected', string>> = {
  person_claim: { approved: 'Approved: the profile is yours.', rejected: 'Not approved: the reviewers could not confirm that the profile is yours.' },
  instructor_verification: { approved: 'Verified: you are a verified instructor.', rejected: 'Not verified from the evidence sent.' },
  relationship_dispute: { approved: 'The link stands: it is verified again.', rejected: 'The link is revoked: it left the public lineage.' },
  // M25: succession, lineage dispute reports, appeals and archival record proposals.
  succession_request: {
    approved: 'Approved: the administration of the schools and organizations moved to you. The teaching history is unchanged.',
    rejected: 'Not approved: nothing was transferred.',
  },
  lineage_report: {
    approved: 'Upheld: the relationship is under review by the moderators.',
    rejected: 'Not upheld: the relationship stays as it is. A report that is not upheld counts against no one.',
  },
  decision_appeal: { approved: 'Upheld: the decision is looked at again.', rejected: 'Not upheld: the decision stands.' },
  record_proposal: { approved: 'Approved: the record was corrected as you proposed.', rejected: 'Not approved: the record stays as it is.' },
};

const APPEAL_STATUS_WORDS = { pending: 'Waiting for a decision', upheld: 'Upheld', rejected: 'Not upheld' } as const;

const MODERATED_KINDS = new Set(['relationship_dispute', 'lineage_report']);

/** ADR 0089: an impersonation report's decision, as each side reads it. */
const IDENTITY_DECISION_WORDS: Record<'reporter' | 'reported', Record<'approved' | 'rejected', string>> = {
  reporter: { approved: 'Upheld.', rejected: 'Not upheld.' },
  reported: { approved: 'The administrators decided that the profile belongs to someone else.', rejected: 'The report was not upheld: the profile stays with you.' },
};

export default async function PartyCasePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const query = await searchParams;
  const path = UUID.test(id) ? `/dashboard/cases/${id}` : '/dashboard/cases';
  const guard = await guardRoute('/dashboard', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const read = UUID.test(id) ? await pageRead(orMissing(serverClient(await headers(), guard.principal).cases.get({ id }))) : 'missing';
  if (!read) return <LoadError {...REVIEW_LOAD_ERRORS.cases} retryHref={path} />;
  if (read === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such case</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This case does not exist, or it is not one of yours.</p>
      </Frame>
    );
  }
  const c = read;
  const initial = await readFormResult(REPLY_FORM, query.outcome);
  const rel = c.relationship;
  const reviewers = MODERATED_KINDS.has(c.kind) ? 'The moderators' : 'The reviewers';
  const appealInitial = await readFormResult(APPEAL_FORM, query.outcome);
  const vouchInitial = c.identity ? await readFormResult(VOUCH_ASK_FORM, query.outcome) : null;
  const codeInitial = c.identity ? await readFormResult(CODE_ADD_FORM, query.outcome) : null;
  const confirmInitial = c.identity ? await readFormResult(CODE_CONFIRM_FORM, query.outcome) : null;

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">{c.kindLabel}</h1>
      <p className="mt-3 flex flex-wrap gap-x-3 text-ui text-fg-muted">
        <span data-testid="party-case-status" data-status={c.status} className="font-semibold text-fg">
          {c.statusLabel}
        </span>
        <span>Opened {formatDay(c.openedAt)}</span>
      </p>
      <div className="mt-8 grid gap-8">
        {query.claimed === '1' ? (
          <OutcomeNote testId="claim-sent">Your claim was sent. A reviewer checks it; you get a notification and an e-mail when they decide.</OutcomeNote>
        ) : null}
        {query.replied === '1' ? <OutcomeNote testId="reply-sent">Your answer was sent to the reviewers.</OutcomeNote> : null}
        {query.sent === '1' && c.identity ? (
          <OutcomeNote testId="identity-sent">Your report was sent. A moderator checks it first; you get a notification when they have.</OutcomeNote>
        ) : null}
        {query.vouch === '1' ? <OutcomeNote testId="vouch-sent">Your question was sent. They answer on their own page; you see here when they have.</OutcomeNote> : null}
        {query.code === 'email' ? <OutcomeNote testId="code-sent">The code is on its way. Type it below when it arrives.</OutcomeNote> : null}
        {query.code === 'page' ? <OutcomeNote testId="code-made">Post the code below on the page, then tell us here in a message that it is there.</OutcomeNote> : null}
        {query.confirmed === '1' ? <OutcomeNote testId="code-confirmed">The code is confirmed.</OutcomeNote> : null}
        {query.appealed === '1' && c.appeal?.appeal ? (
          <OutcomeNote testId="appeal-sent">Your appeal was sent. Another member of staff than the one who decided looks at it.</OutcomeNote>
        ) : null}

        {c.record ? (
          <section aria-labelledby="case-record" className="grid gap-2">
            <h2 id="case-record" className="font-display text-2xl">
              The profile
            </h2>
            <p className="flex flex-wrap items-baseline gap-x-3">
              <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em] font-display text-xl">
                {c.record.names.map((name, i) => (
                  <NameText key={i} name={name} className={i === 0 ? undefined : 'text-[0.78em] text-fg-muted'} />
                ))}
              </span>
              {c.record.unclaimed ? (
                <span className="text-sm font-semibold" data-testid="unclaimed-label">
                  Unclaimed record
                </span>
              ) : null}
            </p>
          </section>
        ) : null}

        {rel ? (
          <section aria-labelledby="case-relationship" className="grid gap-2" data-testid="case-relationship">
            <h2 id="case-relationship" className="font-display text-2xl">
              {c.kind === 'person_claim' ? 'The student’s request' : 'The relationship'}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">Teacher</span>
                <PersonName person={rel.teacher} />
              </div>
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">Student</span>
                <PersonName person={rel.student} />
              </div>
            </div>
            <p className="text-ui">
              <span className="text-fg-muted">Lineage </span>
              {rel.lineageName}
            </p>
          </section>
        ) : null}

        {c.decision ? (
          <section aria-labelledby="case-decision" className="grid gap-2 rounded-sm bg-surface-2 px-4 py-3" data-testid="party-case-decision">
            <h2 id="case-decision" className="font-display text-xl">
              Decision
            </h2>
            <p className="text-ui">
              {c.identity
                ? IDENTITY_DECISION_WORDS[c.identity.side][c.decision.resolution]
                : (DECISION_WORDS[c.kind]?.[c.decision.resolution] ?? (c.decision.resolution === 'approved' ? 'Approved.' : 'Not approved.'))}
            </p>
            {c.identity?.outcome ? (
              <p className="text-sm" data-testid="identity-outcome">
                {c.identity.outcome.profileMoved
                  ? `The profile is yours now. ${c.identity.outcome.photosRemoved > 0 ? `${c.identity.outcome.photosRemoved} photo(s) the other account added were removed. ` : ''}${c.identity.outcome.relationshipsReturned > 0 ? `${c.identity.outcome.relationshipsReturned} student request(s) it had approved wait for your answer in Your students. ` : ''}Check the profile’s text: the other account may have written it.`
                  : c.identity.outcome.takenDown
                    ? 'The copy is off the public pages.'
                    : null}
              </p>
            ) : null}
            {c.decision.reason ? (
              <p className="text-sm whitespace-pre-line">
                <span className="font-semibold">{reviewers}: </span>
                {c.decision.reason}
              </p>
            ) : null}
          </section>
        ) : null}

        {c.appeal ? (
          // M25: one appeal per decision, by a party, within the window; another member of staff decides it.
          <section aria-labelledby="case-appeal" className="grid gap-3" data-testid="party-case-appeal">
            <h2 id="case-appeal" className="font-display text-2xl">
              Appeal
            </h2>
            {c.appeal.appeal ? (
              <p className="text-ui" data-testid="appeal-status" data-status={c.appeal.appeal.status}>
                <span className="text-fg-muted">Appeal: </span>
                <span className="font-semibold">{APPEAL_STATUS_WORDS[c.appeal.appeal.status]}</span>{' '}
                <Link href={`/dashboard/cases/${c.appeal.appeal.caseId}`} className="link inline-flex min-h-11 items-center">
                  Open the appeal
                </Link>
              </p>
            ) : null}
            {c.appeal.canAppeal ? (
              <>
                <p className="max-w-[60ch] text-sm text-fg-muted">
                  If you think this decision is wrong, you can appeal it once, within {c.appeal.windowDays} days of the decision. Another member of
                  staff than the one who decided looks at it.
                </p>
                <AppealForm caseId={c.id} idempotencyKey={randomUUID()} initial={appealInitial} />
              </>
            ) : c.appeal.note && !c.appeal.appeal ? (
              <p className="max-w-[60ch] text-sm text-fg-muted" data-testid="appeal-note">
                {c.appeal.note}
              </p>
            ) : null}
          </section>
        ) : null}

        {c.identity ? (
          <section aria-labelledby="case-identity" className="grid gap-4" data-testid="identity-proof" data-side={c.identity.side} data-status={c.identity.status}>
            <h2 id="case-identity" className="font-display text-2xl">
              {c.identity.side === 'reporter' ? 'Your report' : 'Someone says your profile is theirs'}
            </h2>
            <PersonName person={c.identity.subject} />
            <dl className="grid gap-1 text-ui sm:grid-cols-[auto_1fr] sm:gap-x-6">
              <dt className="text-fg-muted">Where it stands</dt>
              <dd className="font-semibold" data-testid="identity-status">
                {c.identity.statusLabel}
              </dd>
              {c.identity.side === 'reporter' ? (
                <>
                  <dt className="text-fg-muted">Your proof</dt>
                  <dd>{c.identity.routeLabel}</dd>
                </>
              ) : null}
              {c.identity.canProve && c.identity.proofDueAt ? (
                <>
                  <dt className="text-fg-muted">Proof by</dt>
                  <dd>{formatDay(c.identity.proofDueAt)}</dd>
                </>
              ) : null}
            </dl>
            {c.identity.side === 'reported' && c.identity.canProve ? (
              <p className="max-w-[60ch] text-ui">
                While the administrators check, the profile cannot be renamed, hidden, deleted or handed over, and requests to it wait. If it is yours, show it in any of the ways below: people who
                know you can vouch for you, your school’s own mail or website can confirm it, or you can send a short video of yourself saying your name and today’s date. You are not told who
                reported it, and they do not see your proof.
              </p>
            ) : c.identity.canProve ? (
              <p className="max-w-[60ch] text-ui">
                The profile is on hold. Show that you are this person: {c.identity.route === 'own_profile' ? 'your own profile is your proof; add anything else that helps.' : 'use the way you chose, or any of the others below.'} The
                account that holds the profile does not see your proof.
              </p>
            ) : c.identity.status === 'open' ? (
              <p className="max-w-[60ch] text-ui text-fg-muted">A moderator checks your report first. Nothing changes for the profile until then.</p>
            ) : null}

            {c.identity.vouches.length > 0 ? (
              <ul className="grid gap-1 text-ui" data-testid="identity-vouches">
                {c.identity.vouches.map((v) => (
                  <li key={v.id} className="flex flex-wrap items-baseline gap-x-2">
                    <PersonName person={v.voucher} />
                    <span className="text-fg-muted">· {v.kindLabel}</span>
                    <span className="font-semibold" data-answer={v.answer ?? 'none'}>
                      · {v.answer ? 'Answered' : 'Not answered yet'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {c.identity.canProve && c.identity.vouches.length < c.identity.limits.vouches ? (
              <details className="grid gap-3 rounded-sm border border-border-subtle px-4 py-3" open={Boolean(vouchInitial)}>
                <summary className="min-h-11 cursor-pointer content-center font-semibold">Ask someone to vouch for you</summary>
                <p className="mt-2 max-w-[60ch] text-sm text-fg-muted">
                  One verified teacher of yours, or two verified members from different schools. They answer only to the administrators. A member whose account is newer than 30 days, or a student the
                  other account approved, cannot vouch.
                </p>
                <div className="mt-3">
                  <AskVouchForm caseId={c.id} noteMax={c.identity.limits.noteMax} initial={vouchInitial} />
                </div>
              </details>
            ) : null}

            {c.identity.codes.length > 0 ? (
              <ul className="grid gap-3 text-ui" data-testid="identity-codes">
                {c.identity.codes.map((code) => (
                  <li key={code.id} className="grid gap-2 rounded-sm bg-surface-2 px-4 py-3">
                    <span>
                      <span className="font-semibold">{code.channel === 'email' ? `E-mail at ${code.target}` : 'Code for your page'}</span>
                      <span className="text-fg-muted"> · {code.confirmed ? 'Confirmed' : `Valid until ${formatDay(code.expiresAt)}`}</span>
                    </span>
                    {code.channel === 'page' ? (
                      <span>
                        Post <code className="font-mono font-semibold" translate="no" data-testid="identity-public-code">{code.publicCode}</code> on{' '}
                        <span translate="no" className="break-all">
                          {code.target}
                        </span>
                        . An administrator looks for it there.
                      </span>
                    ) : null}
                    {code.channel === 'email' && !code.confirmed && c.identity!.canProve && code.attemptsLeft > 0 ? (
                      <ConfirmCodeForm caseId={c.id} codeId={code.id} initial={confirmInitial?.values?.codeId === code.id ? confirmInitial : null} />
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {c.identity.canProve && c.identity.codes.length < c.identity.limits.codes ? (
              <details className="grid gap-3 rounded-sm border border-border-subtle px-4 py-3" open={Boolean(codeInitial)}>
                <summary className="min-h-11 cursor-pointer content-center font-semibold">Confirm it through your school’s own mail or website</summary>
                <div className="mt-3">
                  <AddCodeForm caseId={c.id} targetMax={c.identity.limits.targetMax} initial={codeInitial} />
                </div>
              </details>
            ) : null}
          </section>
        ) : null}

        <section aria-labelledby="case-messages" className="grid gap-3">
          <h2 id="case-messages" className="font-display text-2xl">
            Messages
          </h2>
          {c.messages.length === 0 ? (
            <p className="text-ui text-fg-muted">No messages yet.</p>
          ) : (
            <ul className="grid gap-3" data-testid="party-case-messages">
              {c.messages.map((message, i) => (
                <li key={i} className="grid gap-1 rounded-sm bg-surface-2 px-4 py-3">
                  <span className="text-sm text-fg-muted">
                    {message.fromYou ? 'You' : reviewers} · {formatDay(message.createdAt)}
                  </span>
                  <span className="text-ui whitespace-pre-line">{message.body}</span>
                </li>
              ))}
            </ul>
          )}
          {c.open ? <ReplyForm caseId={c.id} idempotencyKey={randomUUID()} initial={initial} /> : null}
        </section>

        <section aria-labelledby="case-files" className="grid gap-3">
          <h2 id="case-files" className="font-display text-2xl">
            Your evidence
          </h2>
          {c.files.length === 0 ? (
            <p className="text-ui text-fg-muted">You have sent no files in this case.</p>
          ) : (
            <ul className="grid gap-1 text-sm" data-testid="party-case-files">
              {c.files.map((file) => (
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
          )}
          {c.kind === 'relationship_dispute' ? (
            <p className="max-w-[60ch] text-sm text-fg-muted">Only you, the moderators and the administrators can open your files. The other person cannot.</p>
          ) : null}
          {c.identity ? (
            <p className="max-w-[60ch] text-sm text-fg-muted">
              Only you and the administrators can open your files. A video is deleted 30 days after the decision. Please send no identity documents: we do not ask for them.
            </p>
          ) : null}
          {c.canAddFiles && (!c.identity || c.identity.canProve) ? (
            <EvidenceUploader
              caseId={c.id}
              knownIds={c.files.map((file) => file.id)}
              label={c.identity ? 'Add proof' : 'Add evidence'}
              hint={
                c.identity
                  ? 'A short video (MP4 or WebM, up to 50 MB) of you saying your name and today’s date, or JPEG, PNG, WebP or PDF up to 20 MB.'
                  : 'JPEG, PNG, WebP or PDF, up to 20 MB each. A file added to a case stays with it.'
              }
              // ADR 0089: an impersonation report's case also takes a short MP4 or WebM video, up to 50 MB.
              {...(c.identity ? { accept: 'image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm', maxMb: 50 } : {})}
            />
          ) : null}
        </section>
      </div>
    </Frame>
  );
}
