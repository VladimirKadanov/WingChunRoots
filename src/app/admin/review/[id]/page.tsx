// /admin/review/<id> (milestone M10a, In scope 4; plan §5.6, §6.7): the case card of the review
// queue. The claim (teacher, student, lineage, periods), the teacher's record, the evidence (each
// file a link to /api/evidence/<id> only for those who may open it: the assignee and the
// administrators; the download checks again and answers 404 to anyone else), the notes (the
// claimant's, the questions sent, the internal ones) and the actions this reviewer may take:
// assign, verify, refuse with a reason, ask for more information, add an internal note. The data
// comes from review.get, the actions are thin Server Actions over review.assign, review.decide and
// review.note. A non-staff account sees the explicit denied state. Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { formatSize } from '@/components/evidence/uploader';
import { PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ASSIGN_FORM, DECIDE_FORM, NOTE_FORM } from '../form-ids';
import { AssignForm, DecideForm, NoteForm } from '../forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Review case',
  robots: { index: false },
};

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** A read that answers 404 (or a malformed address): 'missing', for the page's own not-found state. */
async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DONE: Record<string, string> = {
  assigned: 'The case is assigned. You can open its evidence and decide it.',
  unassigned: 'The case is unassigned and back in the queue.',
  verified: 'The claim is verified. The link and both profiles are public now, and the student was told.',
  refused: 'The claim is refused. The student was told and can read your reason.',
  asked: 'Your question was sent to the student. The case waits for their answer.',
  noted: 'The note is added.',
};

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/admin/review" className="link inline-flex min-h-11 items-center">
            Review queue
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-3 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ReviewCasePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const query = await searchParams;
  const path = `/admin/review/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute('/admin/review', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Not available</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="review-denied">
          You don&apos;t have access to the review queue. It is available to archivists, moderators and administrators.
        </p>
      </Frame>
    );
  }
  const view = await pageRead(orMissing(serverClient(await headers(), guard.principal).review.get({ id })));
  if (view === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such case</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This case does not exist, or it is not in the review queue.</p>
      </Frame>
    );
  }
  if (!view) return <LoadError {...LOAD_ERRORS.review} retryHref={path} />;
  const [assignResult, noteResult, verifyResult, rejectResult, askResult] = await Promise.all([
    readFormResult(ASSIGN_FORM, query.outcome),
    readFormResult(NOTE_FORM, query.outcome),
    readFormResult(`${DECIDE_FORM}-verify`, query.outcome),
    readFormResult(`${DECIDE_FORM}-reject`, query.outcome),
    readFormResult(`${DECIDE_FORM}-needs_info`, query.outcome),
  ]);
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;
  const rel = view.relationship;
  const userId = guard.principal!.user.id;

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">{view.kindLabel}</h1>
      <p className="mt-3 flex flex-wrap gap-x-3 text-ui text-fg-muted">
        <span data-testid="case-status" data-status={view.status} className="font-semibold text-fg">
          {view.statusLabel}
        </span>
        <span>Opened {formatDay(view.openedAt)}</span>
        <span>{view.assignee ? (view.assignee.me ? 'Assigned to you' : `Assigned to another reviewer${view.assignee.role ? ` (${view.assignee.role})` : ''}`) : 'Not assigned'}</span>
      </p>
      {done ? (
        <p id="case-outcome" role="status" tabIndex={-1} data-testid="case-outcome" className="mt-5 scroll-mt-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm">
          {done}
        </p>
      ) : null}

      <div className="mt-8 grid gap-10">
        {rel ? (
          <Section id="claim" title="The claim">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">Teacher</span>
                <PersonName person={rel.teacher} />
                {view.teacherRecord ? (
                  <span className="text-sm text-fg-muted" data-testid="teacher-record">
                    {view.teacherRecord.kind === 'historical' ? 'Historical record' : 'Record'} · life status {view.teacherRecord.lifeStatus} ·{' '}
                    {view.teacherRecord.visibility === 'public' ? 'public' : 'not public'}
                    {view.teacherRecord.createdWithClaim ? ' · created with this claim' : ''}
                  </span>
                ) : null}
              </div>
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">Student</span>
                <PersonName person={rel.student} />
              </div>
            </div>
            <p className="text-ui">
              <span className="text-fg-muted">Lineage </span>
              {rel.lineage.name}
            </p>
            <div className="text-ui">
              <PeriodLines periods={rel.periods} />
            </div>
            <div>
              <RelationshipBadge view={rel} />
            </div>
            {view.resolutionReason ? (
              <p className="max-w-[60ch] text-sm whitespace-pre-line">
                <span className="font-semibold">Decision note: </span>
                {view.resolutionReason}
              </p>
            ) : null}
          </Section>
        ) : null}

        <Section id="evidence" title="Evidence">
          {view.files.length === 0 ? (
            <p className="text-ui text-fg-muted">No files.</p>
          ) : (
            <ul className="grid gap-1" data-testid="case-files">
              {view.files.map((file) => (
                <li key={file.id} data-testid="case-file" className="flex flex-wrap items-baseline gap-x-2">
                  {file.href ? (
                    <a href={file.href} className="link inline-flex min-h-11 items-center font-semibold" translate="no">
                      {file.name ?? `${file.kindLabel} file`}
                    </a>
                  ) : (
                    <span className="inline-flex min-h-11 items-center font-semibold" translate="no">
                      {file.name ?? `${file.kindLabel} file`}
                    </span>
                  )}
                  <span className="text-sm text-fg-muted">
                    {file.kindLabel} · {formatSize(file.sizeBytes)} · uploaded {formatDay(file.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.files.some((file) => !file.href) ? (
            <p className="max-w-[60ch] text-sm text-fg-muted">The files open for the reviewer the case is assigned to and for the administrators.</p>
          ) : null}
        </Section>

        <Section id="actions" title="Decision">
          {view.decideNote ? (
            <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="decide-note">
              {view.decideNote}
            </p>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {view.can.assignSelf ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'self', userId }} initial={assignResult} /> : null}
            {view.can.unassign ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'none' }} /> : null}
          </div>
          {view.can.assignOthers ? (
            <div className="max-w-[34rem]">
              <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'choose' }} reviewers={view.reviewers} />
            </div>
          ) : null}
          <div className="grid max-w-[40rem] gap-3">
            {view.can.verify ? <DecideForm caseId={view.id} decision="verify" idempotencyKey={randomUUID()} initial={verifyResult} /> : null}
            {view.can.reject ? <DecideForm caseId={view.id} decision="reject" idempotencyKey={randomUUID()} initial={rejectResult} /> : null}
            {view.can.needsInfo ? <DecideForm caseId={view.id} decision="needs_info" idempotencyKey={randomUUID()} initial={askResult} /> : null}
          </div>
          {!view.can.verify && !view.can.reject && !view.can.needsInfo && !view.can.assignSelf && !view.decideNote ? (
            <p className="text-ui text-fg-muted">This case is closed.</p>
          ) : null}
        </Section>

        <Section id="notes" title="Notes">
          {view.notes.length === 0 ? (
            <p className="text-ui text-fg-muted">No notes yet.</p>
          ) : (
            <ul className="grid gap-3" data-testid="case-notes">
              {view.notes.map((note) => (
                <li key={note.id} data-testid="case-note" data-internal={note.internal ? 'yes' : 'no'} className="grid gap-1 rounded-sm bg-surface-2 px-4 py-3">
                  <span className="text-sm text-fg-muted">
                    {note.author === 'claimant' ? 'The claimant' : note.author === 'you' ? 'You' : `A reviewer${note.authorRole ? ` (${note.authorRole})` : ''}`} ·{' '}
                    {note.internal ? 'internal, reviewers only' : 'shown to the claimant'} · {formatDay(note.createdAt)}
                  </span>
                  <span className="text-ui whitespace-pre-line">{note.body}</span>
                </li>
              ))}
            </ul>
          )}
          {view.can.note ? (
            <div className="max-w-[40rem]">
              <NoteForm caseId={view.id} idempotencyKey={randomUUID()} initial={noteResult} />
            </div>
          ) : null}
        </Section>
      </div>
    </Frame>
  );
}
