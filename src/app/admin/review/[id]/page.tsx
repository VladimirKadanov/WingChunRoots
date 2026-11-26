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

import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { LoadError } from '@/components/account/load-error';
import { reviewLoadError } from '@/app/admin/review/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { PersonAvatar } from '@/components/lineage/person-avatar';
import { OutcomeNote, PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { askTeacherForm, assignForm, DECIDE_FORM, GALLERY_REMOVE_FORM, NOTE_FORM, PHOTO_REMOVE_FORM, RESTORE_FORM, SCHOOL_PHOTO_REMOVE_FORM, TAKEDOWN_FORM } from '../form-ids';
import { AskTeacherForm, AssignForm, DecideForm, NoteForm, RemoveGalleryPhotoForm, RemovePhotoForm, TakeDownForm } from '../forms';
import { lifeStatusChoice } from '../life-status-choice';
import { ListingSection } from '../listing';
import { OrganizationSection } from '../organization';
import { factValue, lifeStatusWord, reviewerLabel, roleName, translateState } from '../text';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Review case'), robots: { index: false } };
}

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

const doneText = (t: AdminT): Record<string, string> => ({
  assigned: t('The case is assigned. You can open its evidence and decide it.'),
  unassigned: t('The case is unassigned and back in the queue.'),
  noted: t('The note is added.'),
  // ADR 0067: review.askTeacher.
  'teacher-asked': t('The teacher is asked. Their answer will appear on this case.'),
  // M14: photos.remove from the case of a reported profile.
  'photo-removed': t('The profile photo is removed. The removal and your reason are in the audit log.'),
  // M16: gallery.remove and schoolPhotos.remove from the case.
  'gallery-photo-removed': t('The photo is removed from the gallery. The removal and your reason are in the audit log.'),
  'school-photo-removed': t('The school photo is removed. The removal and your reason are in the audit log.'),
  // Review 2026-11: moderation.takeDown and moderation.restore from the case of a reported profile.
  'taken-down': t('The record is off the public pages. Your reason is in the audit log and on this case, and the owner, if there is one, was sent it.'),
  restored: t('The record is back. The change and your reason are in the audit log and on this case, and the owner, if there is one, was told.'),
  // M10b: review.arbitrate opens the dispute here.
  arbitrated: t('The relationship is in arbitration. Public pages show it as “Disputed”, and both people were sent your reason and asked for evidence.'),
});
/** What a decision did, in the words of the case's kind (review.get `decisions`). */
const DECIDED = { verified: 'verify', refused: 'reject', asked: 'needs_info' } as const;

/** M10b: the heading of a case's relationship, by kind. */
function relationshipHeading(t: AdminT, kind: string): string {
  if (kind === 'person_claim') return t('The request it answers');
  if (kind === 'relationship_dispute') return t('The relationship');
  return t('The claim');
}

/** The words of a decision from review.get, in the language. */
function decisionText<T extends { label: string; pending: string; reason: string; hint: string; done: string }>(t: AdminT, text: T): T {
  return { ...text, label: t(text.label), pending: t(text.pending), reason: t(text.reason), hint: t(text.hint), done: t(text.done) };
}

function Frame({ t, children, wide = false }: { t: AdminT; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`mx-auto px-page pt-6 pb-10 md:pt-8 md:pb-14 ${wide ? 'max-w-[96rem]' : 'max-w-content'}`}>
      <div className={wide ? undefined : 'max-w-[52rem]'}>
        <p className="eyebrow">
          <Link href="/admin/review" className="link inline-flex min-h-11 items-center">
            {t('Review queue')}
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

function Section({ id, title, children, boxed = false }: { id: string; title: string; children: ReactNode; boxed?: boolean }) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={boxed ? 'grid min-w-0 content-start gap-3 rounded-md border border-border-subtle bg-surface-1 p-5' : 'grid min-w-0 content-start gap-3 border-t border-border-subtle pt-6'}
    >
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
  const t = await getAdminT();
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame t={t}>
        <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="review-denied">
          {t("You don't have access to the review queue. It is available to archivists, moderators and administrators.")}
        </p>
      </Frame>
    );
  }
  const view = await pageRead(orMissing(serverClient(await headers(), guard.principal).review.get({ id })));
  if (view === 'missing') {
    return (
      <Frame t={t}>
        <h1 className="mt-2 font-display text-feature">{t('No such case')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">{t('This case does not exist, or it is not in the review queue.')}</p>
      </Frame>
    );
  }
  if (!view) return <LoadError words={loadErrorWords(t)} {...reviewLoadError(t)} retryHref={path} />;
  const results = await Promise.all([
    readFormResult(assignForm('self'), query.outcome),
    readFormResult(assignForm('none'), query.outcome),
    readFormResult(assignForm('choose'), query.outcome),
    readFormResult(NOTE_FORM, query.outcome),
    readFormResult(`${DECIDE_FORM}-verify`, query.outcome),
    readFormResult(`${DECIDE_FORM}-reject`, query.outcome),
    readFormResult(`${DECIDE_FORM}-needs_info`, query.outcome),
    readFormResult(PHOTO_REMOVE_FORM, query.outcome),
    readFormResult(GALLERY_REMOVE_FORM, query.outcome),
    readFormResult(SCHOOL_PHOTO_REMOVE_FORM, query.outcome),
    readFormResult(TAKEDOWN_FORM, query.outcome),
    readFormResult(RESTORE_FORM, query.outcome),
  ]);
  const [assignResult, unassignResult, chooseResult, noteResult, verifyResult, rejectResult, askResult, photoResult, galleryResult, schoolPhotoResult, takeDownResult, restoreResult] = results.map((state) =>
    state ? translateState(t, state) : state,
  );
  // ADR 0067: a refused "Ask <teacher> to confirm" comes back to that teacher's form.
  const askTeacherResults = new Map<string, NonNullable<typeof assignResult>>();
  for (const c of view.confirmations) {
    if (c.ask) continue;
    const state = await readFormResult(askTeacherForm(c.relationshipId), query.outcome);
    if (state) askTeacherResults.set(c.relationshipId, translateState(t, state));
  }
  const decisions = { verify: decisionText(t, view.decisions.verify), reject: decisionText(t, view.decisions.reject), needs_info: decisionText(t, view.decisions.needs_info) };
  const decided = typeof query.done === 'string' && Object.hasOwn(DECIDED, query.done) ? DECIDED[query.done as keyof typeof DECIDED] : null;
  const done = decided ? decisions[decided].done : typeof query.done === 'string' ? doneText(t)[query.done] : undefined;
  // In a dispute both people are parties; elsewhere the one who opened the case is the claimant.
  // A reviewer's note in a dispute reaches both people; a party's reply only the reviewers (DEFAULT D19).
  const party =
    view.kind === 'relationship_dispute'
      ? { author: t('A party'), shown: t('shown to both people'), reply: t('not shown to the other person') }
      : { author: t('The claimant'), shown: t('shown to the claimant'), reply: t('shown to the claimant') };
  // New for every change (actions.ts doneAt): a new note mounts, so it takes the focus again.
  const doneKey = `${String(query.done)}-${String(query.n)}`;
  const rel = view.relationship;
  const userId = guard.principal!.user.id;
  // M14: the profile photo of the person a case is about (a reported profile), with "Remove photo"
  // for staff who may moderate it. A failed read only leaves the section out.
  const subjectSlug = view.subject?.person && !view.subject.person.removed ? view.subject.person.slug : null;
  const photo = subjectSlug
    ? await serverClient(await headers(), guard.principal)
        .photos.get({ slug: subjectSlug })
        .catch(() => null)
    : null;
  // M16: the rest of that person's gallery, and the logo and room photos of a listing case's school.
  const gallery = subjectSlug
    ? await serverClient(await headers(), guard.principal)
        .gallery.get({ slug: subjectSlug })
        .catch(() => null)
    : null;
  const galleryOthers = gallery && gallery.canModerate ? gallery.photos.filter((p) => !p.isProfile) : [];
  const schoolPhotos = view.school
    ? await serverClient(await headers(), guard.principal)
        .schoolPhotos.get({ schoolId: view.school.id })
        .catch(() => null)
    : null;
  const schoolItems = schoolPhotos && schoolPhotos.canModerate ? [...(schoolPhotos.logo ? [{ id: schoolPhotos.logo.id, src: schoolPhotos.logo.large, label: t('Logo') }] : []), ...(schoolPhotos.banner ? [{ id: schoolPhotos.banner.id, src: schoolPhotos.banner.large, label: t('Banner') }] : []), ...schoolPhotos.rooms.map((r, i) => ({ id: r.id, src: r.large, label: r.caption ?? t('Room photo {n}', { n: i + 1 }) }))] : [];
  const initialFor = (result: typeof galleryResult, photoId: string) => (result?.values?.photoId === photoId ? result : null);

  return (
    <Frame t={t} wide>
      <h1 className="mt-2 font-display text-feature">{t(view.kindLabel)}</h1>
      <dl className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,12rem),1fr))] gap-3 text-ui" data-testid="case-summary">
        <div className="grid gap-0.5 rounded-md border border-border-subtle bg-surface-1 px-4 py-3">
          <dt className="text-sm text-fg-muted">{t('Status')}</dt>
          <dd data-testid="case-status" data-status={view.status} className="font-semibold text-fg">
            {t(view.statusLabel)}
          </dd>
        </div>
        <div className="grid gap-0.5 rounded-md border border-border-subtle bg-surface-1 px-4 py-3">
          <dt className="text-sm text-fg-muted">{t('Opened')}</dt>
          <dd>{t.day(view.openedAt)}</dd>
        </div>
        <div className="grid gap-0.5 rounded-md border border-border-subtle bg-surface-1 px-4 py-3">
          <dt className="text-sm text-fg-muted">{t('Assigned')}</dt>
          <dd className={view.assignee?.me ? 'font-semibold' : undefined}>
            {view.assignee
              ? view.assignee.me
                ? t('Assigned to you')
                : view.assignee.role
                  ? t('Assigned to another reviewer ({role})', { role: roleName(t, view.assignee.role) })
                  : t('Assigned to another reviewer')
              : t('Not assigned')}
          </dd>
        </div>
        <div className="grid gap-0.5 rounded-md border border-border-subtle bg-surface-1 px-4 py-3">
          <dt className="text-sm text-fg-muted">{t('Last change')}</dt>
          <dd>{t.day(view.updatedAt)}</dd>
        </div>
      </dl>
      {/* What a change did takes the focus (OutcomeNote, the M09 pattern; M10a review, screens-5).
          A note's confirmation sits under the notes instead, where the reviewer is. */}
      {done && query.done !== 'noted' ? (
        <div key={doneKey} className="mt-5">
          <OutcomeNote testId="case-outcome">{done}</OutcomeNote>
        </div>
      ) : null}

      {/* Control panel: what the case is about on the left, what the reviewer can do on the right
          (from 1024 px); on a phone the actions follow the case and its notes. */}
      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] lg:items-start">
        <div className="grid min-w-0 gap-10 lg:col-start-1 lg:row-start-1">
        {view.subject ? (
          <Section id="subject" title={t(view.subject.label)}>
            {view.subject.person ? <PersonName person={view.subject.person} /> : null}
            {view.subject.facts.length > 0 ? (
              <dl className="grid gap-2 text-ui sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]" data-testid="subject-facts">
                {view.subject.facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-fg-muted">{t(fact.label)}</dt>
                    <dd className="whitespace-pre-line">{factValue(t, fact.value)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {!rel && view.resolutionReason ? (
              <p className="max-w-[60ch] text-sm whitespace-pre-line">
                <span className="font-semibold">{t('Decision note:')} </span>
                {view.resolutionReason}
              </p>
            ) : null}
          </Section>
        ) : null}

        {/* Role replay 2026-11-25 (P3-8, ADR 0067): the record's verified teachers who have an account. */}
        {view.confirmations.length > 0 ? (
          <Section id="teachers" title={t('Ask the record’s teacher')}>
            <p className="max-w-[60ch] text-ui text-fg-muted">
              {t('A verified teacher of the record can tell you whether the claim is their student’s. They see their student’s name and nothing of the claimant; only reviewers read the answer.')}
            </p>
            <ul className="grid gap-4" data-testid="case-confirmations">
              {view.confirmations.map((c) => (
                <li key={c.relationshipId} className="grid gap-2 border-l-4 border-border-subtle pl-4" data-testid="case-confirmation" data-state={c.ask ? (c.ask.answer ?? 'asked') : 'not-asked'}>
                  <PersonName person={c.teacher} />
                  {c.ask ? (
                    c.ask.answer ? (
                      <p className="text-ui">
                        <span className="font-semibold">{t(c.ask.answerLabel!)}</span>{' '}
                        <span className="text-fg-muted">· {t('answered on {day}', { day: t.day(c.ask.answeredAt!) })}</span>
                        {c.ask.note ? <span className="mt-1 block whitespace-pre-line">{c.ask.note}</span> : null}
                      </p>
                    ) : (
                      <p className="text-ui text-fg-muted">{t('Asked on {day}. No answer yet.', { day: t.day(c.ask.askedAt) })}</p>
                    )
                  ) : view.can.askTeacher ? (
                    <AskTeacherForm caseId={view.id} relationshipId={c.relationshipId} teacher={c.teacher.name} initial={askTeacherResults.get(c.relationshipId) ?? null} />
                  ) : (
                    <p className="text-ui text-fg-muted">{t('Not asked.')}</p>
                  )}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {photo && photo.photo && photo.canModerate && subjectSlug ? (
          <Section id="photo" title={t('Profile photo')}>
            <PersonAvatar name={view.subject!.person!.name.value} photo={photo.photo} size="lg" />
            <div className="max-w-[40rem]">
              <RemovePhotoForm caseId={view.id} slug={subjectSlug} initial={photoResult} />
            </div>
          </Section>
        ) : null}

        {galleryOthers.length > 0 ? (
          <Section id="gallery" title={t('Other photos of the gallery')}>
            <ul className="grid gap-6">
              {galleryOthers.map((p, i) => (
                <li key={p.id} className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid="case-gallery-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.large} alt={p.caption ?? t('Gallery photo {n}', { n: i + 1 })} width={128} height={128} className="size-32 rounded-sm border border-border-strong object-cover" />
                  <div className="max-w-[40rem]">
                    <RemoveGalleryPhotoForm caseId={view.id} photoId={p.id} kind="person" initial={initialFor(galleryResult, p.id)} />
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {schoolItems.length > 0 ? (
          <Section id="school-photos" title={t("The school's logo and photos")}>
            <ul className="grid gap-6">
              {schoolItems.map((p) => (
                <li key={p.id} className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]" data-testid="case-school-photo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.src} alt={p.label} width={128} height={128} className="size-32 rounded-sm border border-border-strong bg-surface-1 object-contain" />
                  <div className="max-w-[40rem]">
                    <RemoveGalleryPhotoForm caseId={view.id} photoId={p.id} kind="school" initial={initialFor(schoolPhotoResult, p.id)} />
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {rel ? (
          <Section id="claim" title={relationshipHeading(t, view.kind)}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">{t('Teacher')}</span>
                <PersonName person={rel.teacher} />
                {view.teacherRecord ? (
                  <span className="text-sm text-fg-muted" data-testid="teacher-record">
                    {view.teacherRecord.kind === 'historical' ? t('Historical record') : t('Record')} · {t('life status {status}', { status: lifeStatusWord(t, view.teacherRecord.lifeStatus) })} ·{' '}
                    {view.teacherRecord.visibility === 'public' ? t('public') : t('not public')}
                    {view.teacherRecord.createdWithClaim ? ` · ${t('created with this claim')}` : ''}
                  </span>
                ) : null}
              </div>
              <div className="grid content-start gap-1">
                <span className="text-sm text-fg-muted">{t('Student')}</span>
                <PersonName person={rel.student} />
              </div>
            </div>
            <p className="text-ui">
              <span className="text-fg-muted">{t('Lineage')} </span>
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
                <span className="font-semibold">{t('Decision note:')} </span>
                {view.resolutionReason}
              </p>
            ) : null}
          </Section>
        ) : null}

        {view.school ? <ListingSection school={view.school} reason={view.resolutionReason} t={t} /> : null}
        {view.organization ? <OrganizationSection organization={view.organization} t={t} /> : null}

        {view.school ? null : (
        <Section id="evidence" title={t('Evidence')}>
          {view.files.length === 0 ? (
            <p className="text-ui text-fg-muted">{t('No files.')}</p>
          ) : (
            <ul className="grid gap-1" data-testid="case-files">
              {view.files.map((file) => (
                <li key={file.id} data-testid="case-file" className="flex flex-wrap items-baseline gap-x-2">
                  {file.href ? (
                    <a href={file.href} className="link inline-flex min-h-11 items-center font-semibold" translate="no">
                      {file.name ?? t('{kind} file', { kind: t(file.kindLabel) })}
                    </a>
                  ) : (
                    <span className="inline-flex min-h-11 items-center font-semibold" translate="no">
                      {file.name ?? t('{kind} file', { kind: t(file.kindLabel) })}
                    </span>
                  )}
                  <span className="text-sm text-fg-muted">
                    {t(file.kindLabel)} · {formatSize(file.sizeBytes)} · {t('uploaded {day}', { day: t.day(file.createdAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {view.files.some((file) => !file.href) ? (
            <p className="max-w-[60ch] text-sm text-fg-muted">{t('The files open for the reviewer the case is assigned to and for the administrators.')}</p>
          ) : null}
        </Section>
        )}

        <Section id="notes" title={t('Notes')}>
          {view.notes.length === 0 ? (
            <p className="text-ui text-fg-muted">{t('No notes yet.')}</p>
          ) : (
            <ul className="grid gap-3" data-testid="case-notes">
              {view.notes.map((note) => (
                <li key={note.id} data-testid="case-note" data-internal={note.internal ? 'yes' : 'no'} className="grid gap-1 rounded-sm bg-surface-2 px-4 py-3">
                  <span className="text-sm text-fg-muted">
                    {note.author === 'claimant'
                      ? note.authorSide === 'teacher'
                        ? t('The teacher')
                        : note.authorSide === 'student'
                          ? t('The student')
                          : party.author
                      : note.author === 'you'
                        ? t('You')
                        : note.authorRole
                          ? t('A reviewer ({role})', { role: roleName(t, note.authorRole) })
                          : t('A reviewer')}{' '}
                    · {note.internal ? t('internal, reviewers only') : note.author === 'claimant' ? party.reply : party.shown} · {t.day(note.createdAt)}
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

        <aside aria-label={t('What you can do on this case')} className="grid min-w-0 content-start gap-6 lg:row-start-1 lg:col-start-2">
        <Section id="actions" title={t('Decision')} boxed>
          {view.decideNote ? (
            <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="decide-note">
              {t(view.decideNote)}
            </p>
          ) : null}
          {/* On a phone each form takes the full width, so its button does too (screens-10). */}
          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start">
            {view.can.assignSelf ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'self', userId }} initial={assignResult} /> : null}
            {view.can.unassign ? <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'none' }} initial={unassignResult} /> : null}
          </div>
          {view.can.assignOthers ? (
            <div className="max-w-[34rem]">
              <AssignForm caseId={view.id} idempotencyKey={randomUUID()} mode={{ kind: 'choose' }} reviewers={view.reviewers.map((reviewer) => ({ ...reviewer, label: reviewerLabel(t, reviewer.label) }))} initial={chooseResult} />
            </div>
          ) : null}
          <div className="grid max-w-[40rem] gap-3">
            {view.can.verify ? <DecideForm caseId={view.id} decision="verify" idempotencyKey={randomUUID()} initial={verifyResult} text={decisions.verify} schoolVersion={view.school?.version ?? null} organizationVersion={view.organization?.version ?? null} takeDownOption={view.kind === 'profile_report' && view.subject?.takeDown?.allowed === true && !view.subject.takeDown.held} lifeStatusChoice={view.kind === 'historical_claim' && view.teacherRecord?.lifeStatus === 'unknown' ? lifeStatusChoice(t) : undefined} /> : null}
            {view.can.reject ? <DecideForm caseId={view.id} decision="reject" idempotencyKey={randomUUID()} initial={rejectResult} text={decisions.reject} schoolVersion={view.school?.version ?? null} organizationVersion={view.organization?.version ?? null} /> : null}
            {view.can.needsInfo ? <DecideForm caseId={view.id} decision="needs_info" idempotencyKey={randomUUID()} initial={askResult} text={decisions.needs_info} schoolVersion={view.school?.version ?? null} organizationVersion={view.organization?.version ?? null} /> : null}
          </div>
          {!view.can.verify && !view.can.reject && !view.can.needsInfo && !view.can.assignSelf && !view.decideNote ? (
            <p className="text-ui text-fg-muted">{t('This case is closed.')}</p>
          ) : null}
        </Section>

        {view.subject?.takeDown?.allowed && view.subject.person && subjectSlug ? (
          <Section id="takedown" title={t('Public pages')} boxed>
            <p className="max-w-[60ch] text-ui" data-testid="takedown-state">
              {view.subject.takeDown.held ? (
                <>
                  <span className="font-semibold">{t('Taken down by staff.')}</span>{' '}
                  {t('The profile is off every public page; its owner and the people at the other end of its links still see it.')}
                  {view.subject.takeDown.reason ? <span className="block whitespace-pre-line text-fg-muted">{t('Reason: {reason}', { reason: view.subject.takeDown.reason })}</span> : null}
                </>
              ) : (
                <>{t('Upholding the report hides nothing by itself. You can take the profile down here, or tick the box when you uphold the report.')}</>
              )}
            </p>
            <div className="max-w-[40rem]">
              <TakeDownForm
                personId={view.subject.person.id}
                slug={subjectSlug}
                caseId={view.id}
                held={view.subject.takeDown.held}
                initial={view.subject.takeDown.held ? restoreResult : takeDownResult}
              />
            </div>
          </Section>
        ) : null}

        </aside>
      </div>
    </Frame>
  );
}
