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
import { REPLY_FORM } from './form-ids';
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
  const reviewers = c.kind === 'relationship_dispute' ? 'The moderators' : 'The reviewers';

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
            <p className="text-ui">{DECISION_WORDS[c.kind]?.[c.decision.resolution] ?? (c.decision.resolution === 'approved' ? 'Approved.' : 'Not approved.')}</p>
            {c.decision.reason ? (
              <p className="text-sm whitespace-pre-line">
                <span className="font-semibold">{reviewers}: </span>
                {c.decision.reason}
              </p>
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
          {c.canAddFiles ? (
            <EvidenceUploader
              caseId={c.id}
              knownIds={c.files.map((file) => file.id)}
              label="Add evidence"
              hint="JPEG, PNG, WebP or PDF, up to 20 MB each. A file added to a case stays with it."
            />
          ) : null}
        </section>
      </div>
    </Frame>
  );
}
