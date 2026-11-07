// /dashboard/students (milestone M19, In scope 2 and 7; docs/adr/0022-passport.md): the passports of
// the students this account records for: its established students (a verified relationship records,
// one in arbitration is read only) and the members of the approved organizations it administers.
// With ?student=<person id> one of them: their entries (a teacher sees the whole passport, an
// organization's admin its own entries), "Record a rank / an examination / a form or skill", the
// change and withdrawal of what this account recorded, and "Mark as attended" of this account's
// past events. DEFAULT M19 (question 1): the student never records their own. The requests that
// wait for this teacher stay at /dashboard/students/requests (M09). Data from passport.students;
// changes through thin Server Actions (./actions.ts). Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { EntryLine } from '@/components/passport/passport-view';
import { messageId } from '@/lib/form-state';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { PassportStudent, PassportStudents } from '@/server/services/passport';
import { ATTENDANCE_FORM, ENTRY_FORM, EXAM_FORM, RANK_FORM, SKILL_FORM, WITHDRAW_FORM } from './form-ids';
import { AttendanceButton, EditEntryForm, ExamForm, RankForm, SkillForm, WithdrawButton } from './passport-forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your students’ passports',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/students';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/** How this account stands to the student, in words. */
function standing(student: PassportStudent): string {
  if (student.relationship === 'verified') return 'Your student · you record';
  if (student.relationship === 'in_arbitration') return 'In arbitration · read only';
  return `Member of ${student.organizations.map((o) => o.name).join(', ')} · you record for it`;
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-heading`} id={id} className="grid scroll-mt-24 gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

const NOTICES: Record<string, string> = {
  rank: 'The rank is recorded. The student was told.',
  exam: 'The examination is recorded. The student was told.',
  skill: 'The form or skill is recorded. The student was told.',
};

export default async function StudentsPassportPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const studentId = UUID.test(one(query.student)) ? one(query.student) : null;
  const client = serverClient(await headers(), guard.principal);
  let view: PassportStudents | 'not-yours' | null;
  try {
    view = await pageRead(client.passport.students({ personId: studentId }));
  } catch {
    // A student who is not this account's (or no longer is): the list, with a word.
    view = 'not-yours';
  }
  if (view === 'not-yours') view = await pageRead(client.passport.students({}));
  const notYours = studentId !== null && view !== null && view.selected === null;
  if (view === null) {
    return (
      <LoadError
        eyebrow="Dashboard"
        title="Your students’ passports"
        message="We couldn't load your students. Nothing was changed."
        retryHref={studentId ? `${PAGE}?student=${studentId}` : PAGE}
        back={{ href: '/dashboard', label: 'Back to the dashboard' }}
      />
    );
  }
  const [rankOutcome, examOutcome, skillOutcome, entryOutcome, withdrawOutcome, attendanceOutcome] = await Promise.all([
    readFormResult(RANK_FORM, query.outcome),
    readFormResult(EXAM_FORM, query.outcome),
    readFormResult(SKILL_FORM, query.outcome),
    readFormResult(ENTRY_FORM, query.outcome),
    readFormResult(WITHDRAW_FORM, query.outcome),
    readFormResult(ATTENDANCE_FORM, query.outcome),
  ]);
  const selected = view.selected;
  const here = selected ? `${PAGE}?student=${selected.student.personId}` : PAGE;
  const editing = entryOutcome?.values?.id ?? (UUID.test(one(query.edit)) ? one(query.edit) : null);
  const organizations = selected ? (selected.student.relationship === 'verified' ? view.organizations : selected.student.organizations).map((o) => ({ value: o.id, label: o.name })) : [];
  const examiners = selected ? selected.examiners.map((e) => ({ value: e.personId, label: `${e.name.value} (${e.note})` })) : [];
  const notice =
    NOTICES[one(query.recorded)] ??
    (query.changed === '1' ? 'The entry is changed.' : query.withdrawn === '1' ? 'The entry is withdrawn: kept, and shown to nobody.' : query.attended === '1' ? 'Marked as attended. The student was told.' : null);
  const rowError = [withdrawOutcome, attendanceOutcome].find((o) => o?.status === 'error') ?? null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your students’ passports</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          You record the ranks, examinations, forms and skills of the students whose relationship with you is verified, and of the members of an organization you
          administer. Each student decides what their profile shows and can propose a correction.
        </p>
        <p className="mt-3 flex flex-wrap gap-x-4 text-ui">
          <Link href="/dashboard/students/requests" className="link inline-flex min-h-11 items-center">
            Student requests
          </Link>
        </p>
        {notice ? (
          <p role="status" className="mt-4 text-ui font-semibold" data-testid="students-notice">
            {notice}
          </p>
        ) : null}
        {rowError ? (
          <p id={messageId(rowError === withdrawOutcome ? WITHDRAW_FORM : ATTENDANCE_FORM)} role="alert" tabIndex={-1} className="mt-4 text-ui text-danger">
            <span className="font-semibold">Not changed:</span> {rowError.message}
          </p>
        ) : null}
        {notYours ? (
          <p role="status" className="mt-4 text-ui" data-testid="students-not-yours">
            That person is not one of the students you record for.
          </p>
        ) : null}

        <div className="mt-8 grid gap-10">
          <Block id="students" title="Students">
            {view.students.length === 0 ? (
              <p className="text-fg-muted" data-testid="students-empty">
                {view.hasProfile
                  ? 'No students yet. Once you approve a student’s request, their passport is here.'
                  : 'You have no profile yet. Finish setting up your profile first: you record for your students from it.'}
              </p>
            ) : (
              <ul className="grid gap-1" aria-label="Your students">
                {view.students.map((s) => (
                  <li key={s.personId} data-testid="passport-student" data-relationship={s.relationship ?? 'organization'}>
                    <Link
                      href={`${PAGE}?student=${s.personId}#student`}
                      aria-current={selected?.student.personId === s.personId ? 'page' : undefined}
                      className="flex min-h-11 flex-wrap items-center gap-x-3 rounded-sm px-2 py-1.5 hover:bg-surface-2 aria-[current=page]:bg-surface-2 aria-[current=page]:font-semibold"
                    >
                      <span className="link font-display text-lg">
                        <NameText name={s.name} />
                      </span>
                      <span className="text-sm text-fg-muted">{standing(s)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Block>

          {selected ? (
            <>
              <section aria-labelledby="student-heading" id="student" className="grid scroll-mt-24 gap-3 border-t border-border-strong pt-6" data-testid="passport-selected-student">
                <p className="eyebrow">Passport of</p>
                <h2 id="student-heading" className="font-display text-feature">
                  <NameText name={selected.student.name} />
                </h2>
                <p className="text-ui">{standing(selected.student)}</p>
                <p className="flex flex-wrap gap-x-4 text-ui">
                  <Link href={`/people/${selected.student.slug}`} className="link inline-flex min-h-11 items-center">
                    See their profile
                  </Link>
                </p>
                {!selected.student.canRecord ? (
                  <p className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="passport-read-only">
                    While your relationship with this student is in arbitration, their passport can be read but not changed.
                  </p>
                ) : null}
              </section>

              <Block id="entries" title="Entries">
                {selected.entries.length === 0 ? (
                  <p className="text-fg-muted">Nothing recorded yet.</p>
                ) : (
                  <ol className="grid gap-5" aria-label="Their entries, the latest first">
                    {selected.entries.map((entry) => (
                      <li key={`${entry.kind}:${entry.id}`} id={`entry-${entry.id}`} className="grid scroll-mt-24 gap-3 border-t border-border-subtle pt-4" data-testid="student-passport-entry" data-kind={entry.kind}>
                        <EntryLine entry={entry}>
                          <p className="text-sm text-fg-muted">{entry.visibility === 'private' ? 'Private: the student keeps it off their profile' : entry.shownOnProfile ? 'Public: shown on their profile' : 'Public: not shown on their profile now'}</p>
                          {entry.correction ? (
                            <p className="rounded-sm border-l-4 border-fg bg-surface-2 px-3 py-2 text-sm" data-testid="student-correction">
                              <span className="font-semibold">The student proposes a correction:</span> “{entry.correction.note}”
                            </p>
                          ) : null}
                        </EntryLine>
                        {entry.canChange && (entry.kind === 'rank' || entry.kind === 'exam' || entry.kind === 'skill') && editing === entry.id ? (
                          <EditEntryForm
                            personId={selected.student.personId}
                            kind={entry.kind}
                            id={entry.id}
                            title={entry.title}
                            date={entry.date}
                            progress={entry.progress}
                            cancelHref={`${here}#entry-${entry.id}`}
                            initial={entryOutcome}
                          />
                        ) : entry.canChange ? (
                          <div className="flex flex-wrap items-start gap-2">
                            {entry.kind === 'rank' || entry.kind === 'exam' || entry.kind === 'skill' ? (
                              <Link href={`${here}&edit=${entry.id}#entry-${entry.id}`} className="link inline-flex min-h-11 items-center px-2" data-testid="passport-change">
                                Change<span className="sr-only"> “{entry.title}”</span>
                              </Link>
                            ) : null}
                            <WithdrawButton
                              personId={selected.student.personId}
                              kind={entry.kind}
                              id={entry.id}
                              title={entry.title}
                              initial={withdrawOutcome?.values?.id === entry.id ? withdrawOutcome : null}
                            />
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                )}
              </Block>

              {selected.student.canRecord ? (
                <>
                  <Block id="record-rank" title="Record a rank">
                    <RankForm personId={selected.student.personId} organizations={organizations} initial={rankOutcome} />
                  </Block>
                  <Block id="record-exam" title="Record an examination">
                    <ExamForm personId={selected.student.personId} organizations={organizations} examiners={examiners} initial={examOutcome} />
                  </Block>
                  <Block id="record-skill" title="Record a form or skill">
                    <SkillForm personId={selected.student.personId} organizations={organizations} initial={skillOutcome} />
                  </Block>
                </>
              ) : null}

              {selected.student.relationship === 'verified' ? (
                <Block id="events" title="Events attended">
                  {selected.events.length === 0 ? (
                    <p className="text-fg-muted">No past events of yours. Once an event you organized or taught at has taken place, you can mark who attended.</p>
                  ) : (
                    <ul className="grid gap-3" aria-label="Your past events">
                      {selected.events.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3" data-testid="passport-event" data-attended={e.attended}>
                          <span className="grid">
                            <Link href={`/events/${e.slug}`} className="link inline-flex min-h-11 items-center font-display text-lg">
                              {e.title}
                            </Link>
                            <span className="text-sm text-fg-muted tabular">{e.dateText}</span>
                          </span>
                          {e.attended ? (
                            <span className="inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="passport-attended">
                              <svg aria-hidden="true" viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5}>
                                <circle cx="8" cy="8" r="6.25" />
                                <path d="M5 8.2l2 2 4-4.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                              Attended
                            </span>
                          ) : (
                            <AttendanceButton
                              personId={selected.student.personId}
                              eventId={e.id}
                              title={e.title}
                              initial={attendanceOutcome?.values?.eventId === e.id ? attendanceOutcome : null}
                            />
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </Block>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
