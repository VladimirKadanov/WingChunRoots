// /admin/review/<id> (milestone M10a, In scope 4; plan §5.6, §6.7): the case card of the review
// queue. The claim (teacher, student, lineage, periods), the teacher's record, the evidence (each
// file a link to /api/evidence/<id> only for those who may open it: the assignee and the
// administrators; the download checks again and answers 404 to anyone else), the notes (the
// claimant's, the questions sent, the internal ones) and the actions this reviewer may take:
// assign, verify, refuse with a reason, ask for more information, add an internal note. The data
// comes from review.get, the actions are thin Server Actions over review.assign, review.decide and
// review.note. A non-staff account sees the explicit denied state. Reads the session.
//
// M10b: the other kinds (a profile claim, an instructor verification, a profile report, a
// relationship dispute) show what the case is about (review.get `subject`) and the words of their
// own decisions (`decisions`).

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { assignForm, DECIDE_FORM, NOTE_FORM } from '../form-ids';
import { AssignForm, DecideForm, NoteForm } from '../forms';
import { ListingSection } from '../listing';

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
  noted: 'The note is added.',
  // M10b: review.arbitrate opens the dispute here.
  arbitrated: 'The relationship is in arbitration. Public pages show it as “Disputed”, and both people were sent your reason and asked for evidence.',
};
/** What a decision did, in the words of the case's kind (review.get `decisions`). */
const DECIDED = { verified: 'verify', refused: 'reject', asked: 'needs_info' } as const;

/** M10b: the heading of a case's relationship, by kind. */
const RELATIONSHIP_HEADING: Record<string, string> = {
  person_claim: 'The request it answers',
  relationship_dispute: 'The relationship',
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
  if (!view) return <LoadError {...REVIEW_LOAD_ERRORS.review} retryHref={path} />;
  const [assignResult, unassignResult, chooseResult, noteResult, verifyResult, rejectResult, askResult] = await Promise.all([
    readFormResult(assignForm('self'), query.outcome),
    readFormResult(assignForm('none'), query.outcome),
    readFormResult(assignForm('choose'), query.outcome),
    readFormResult(NOTE_FORM, query.outcome),
    readFormResult(`${DECIDE_FORM}-verify`, query.outcome),
    readFormResult(`${DECIDE_FORM}-reject`, query.outcome),
    readFormResult(`${DECIDE_FORM}-needs_info`, query.outcome),
  ]);
  const decided = typeof query.done === 'string' && Object.hasOwn(DECIDED, query.done) ? DECIDED[query.done as keyof typeof DECIDED] : null;
  const done = decided ? view.decisions[decided].done : typeof query.done === 'string' ? DONE[query.done] : undefined;
  // In a dispute both people are parties; elsewhere the one who opened the case is the claimant.
  // A reviewer's note in a dispute reaches both people; a party's reply only the reviewers (DEFAULT D19).
  const party =
    view.kind === 'relationship_dispute'
      ? { author: 'A party', shown: 'shown to both people', reply: 'not shown to the other person' }
      : { author: 'The claimant', shown: 'shown to the claimant', reply: 'shown to the claimant' };
  // New for every change (actions.ts doneAt): a new note mounts, so it takes the focus again.
  const doneKey = `${String(query.done)}-${String(query.n)}`;
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
      {/* What a change did takes the focus (OutcomeNote, the M09 pattern; M10a review, screens-5).
          A note's confirmation sits under the notes instead, where the reviewer is. */}
      {done && query.done !== 'noted' ? (
        <div key={doneKey} className="mt-5">
          <OutcomeNote testId="case-outcome">{done}</OutcomeNote>
        </div>
      ) : null}

      <div className="mt-8 grid gap-10">
        {view.subject ? (
          <Section id="subject" title={view.subject.label}>
            {view.subject.person ? <PersonName person={view.subject.person} /> : null}
            {view.subject.facts.length > 0 ? (
              <dl className="grid gap-2 text-ui sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]" data-testid="subject-facts">
                {view.subject.facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-fg-muted">{fact.label}</dt>
                    <dd className="whitespace-pre-line">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {!rel && view.resolutionReason ? (
              <p className="max-w-[60ch] text-sm whitespace-pre-line">
                <span className="font-semibold">Decision note: </span>
                {view.resolutionReason}
              </p>
            ) : null}
          </Section>
        ) : null}

        {rel ? (
          <Section id="claim" title={RELATIONSHIP_HEADING[view.kind] ?? 'The claim'}>
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

        {view.school ? <ListingSection school={view.school} reason={view.resolutionReason} /> : null}

        {view.school ? null : (
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
        )}

        <Section id="actions" title="Decision">
          {view.decideNote ? (
            <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="decide-note">
              {view.decideNote}
            </p>
          ) : null}
          {/* On a phone each form takes the full width, so its button does too (screens-10). */}
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start">
            {view.can.assignSelf ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'self', userId }} initial={assignResult} /> : null}
            {view.can.unassign ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'none' }} initial={unassignResult} /> : null}
          </div>
          {view.can.assignOthers ? (
            <div className="max-w-[34rem]">
              <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'choose' }} reviewers={view.reviewers} initial={chooseResult} />
            </div>
          ) : null}
          <div className="grid max-w-[40rem] gap-3">
            {view.can.verify ? <DecideForm caseId={view.id} decision="verify" idempotencyKey={randomUUID()} initial={verifyResult} text={view.decisions.verify} schoolVersion={view.school?.version ?? null} /> : null}
            {view.can.reject ? <DecideForm caseId={view.id} decision="reject" idempotencyKey={randomUUID()} initial={rejectResult} text={view.decisions.reject} schoolVersion={view.school?.version ?? null} /> : null}
            {view.can.needsInfo ? <DecideForm caseId={view.id} decision="needs_info" idempotencyKey={randomUUID()} initial={askResult} text={view.decisions.needs_info} schoolVersion={view.school?.version ?? null} /> : null}
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
                    {note.author === 'claimant'
                      ? note.authorSide
                        ? `The ${note.authorSide}`
                        : party.author
                      : note.author === 'you'
                        ? 'You'
                        : `A reviewer${note.authorRole ? ` (${note.authorRole})` : ''}`}{' '}
                    · {note.internal ? 'internal, reviewers only' : note.author === 'claimant' ? party.reply : party.shown} · {formatDay(note.createdAt)}
                  </span>
                  <span className="text-ui whitespace-pre-line">{note.body}</span>
                </li>
              ))}
            </ul>
          )}
          {done && query.done === 'noted' ? (
            <OutcomeNote key={doneKey} testId="case-outcome">
              {done}
            </OutcomeNote>
          ) : null}
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
