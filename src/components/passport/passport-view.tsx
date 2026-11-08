// The training passport as a profile shows it (milestone M19, In scope 7): the current rank on top,
// experience, the teachers with their periods and, on a full passport, the timeline by year (the
// latest first). Made only from the public DTO (passport.get), so nothing private can reach it.
// Every status is a word and a shape, never colour alone (CLAUDE.md §10). The marks and the entry
// line are shared with the owner's and the teacher's dashboards.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { cx } from '@/lib/cx';
import { timelineByYear } from '@/lib/passport-time';
import { PASSPORT_KIND_LABELS, type PassportDto, type PassportEntryDto, type PassportTeacherDto } from '@/server/dto/passport';

/** The mark of an entry's kind: a shape for each, beside its word. */
export function KindMark({ kind, className }: { kind: PassportEntryDto['kind']; className?: string }) {
  const paths: Record<PassportEntryDto['kind'], ReactNode> = {
    rank: <path d="M3 13h10M4 13V7l4-4 4 4v6" />,
    exam: (
      <>
        <rect x="3" y="2.5" width="10" height="11" rx="1" />
        <path d="M5.5 8l2 2 3-4" />
      </>
    ),
    skill: <path d="M2.5 12.5c3-1 5-4 5.5-9 .5 5 2.5 8 5.5 9" />,
    certificate: (
      <>
        <rect x="2" y="3" width="12" height="8" rx="1" />
        <path d="M6 11v3l2-1 2 1v-3" />
      </>
    ),
    attendance: (
      <>
        <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
        <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
      </>
    ),
  };
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-label font-semibold uppercase text-fg-muted', className)} data-kind={kind}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
        {paths[kind]}
      </svg>
      {PASSPORT_KIND_LABELS[kind]}
    </span>
  );
}

/** A form or skill: "Learning" (a half-filled circle) or "Approved by the teacher" (a ticked circle). */
export function ProgressMark({ progress, label }: { progress: 'learning' | 'approved'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold" data-testid="skill-progress" data-progress={progress}>
      <svg aria-hidden="true" viewBox="0 0 16 16" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="8" cy="8" r="6.25" />
        {progress === 'approved' ? <path d="M5 8.2l2 2 4-4.2" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M8 1.75a6.25 6.25 0 0 1 0 12.5z" fill="currentColor" />}
      </svg>
      {label}
    </span>
  );
}

/** "Examiner: …", "Teacher: …", the organization and the event: the details of an entry, linked. */
export function EntryDetails({ entry }: { entry: PassportEntryDto }) {
  const parts: ReactNode[] = [];
  if (entry.examiner) {
    parts.push(
      <span key="examiner">
        Examiner:{' '}
        <Link href={`/people/${entry.examiner.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center">
          <NameText name={entry.examiner.name} />
        </Link>
      </span>,
    );
  }
  if (entry.teacher && entry.kind !== 'certificate') {
    parts.push(
      <span key="teacher">
        {entry.kind === 'attendance' ? 'Marked by ' : 'Recorded by '}
        <Link href={`/people/${entry.teacher.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center">
          <NameText name={entry.teacher.name} />
        </Link>
      </span>,
    );
  }
  if (entry.organization) {
    parts.push(
      <span key="organization">
        {entry.kind === 'attendance' ? '' : 'Organization: '}
        <Link href={`/organizations/${entry.organization.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center">
          {entry.organization.name}
        </Link>
      </span>,
    );
  }
  if (entry.event) {
    parts.push(
      <span key="event">
        <Link href={`/events/${entry.event.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center">
          {entry.event.kindLabel} page
        </Link>
      </span>,
    );
  }
  if (parts.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-4 text-sm text-fg-muted">
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </p>
  );
}

/** One entry: its kind, title, date, status and details; the certificate's square beside it. */
export function EntryLine({ entry, children }: { entry: PassportEntryDto; children?: ReactNode }) {
  return (
    <div className="flex gap-4">
      {entry.image ? (
        <a href={entry.image.full} className="shrink-0 rounded-sm outline-offset-2" data-testid="certificate-thumb">
          {/* A plain <img>: the app serves the WebP renditions itself, already square. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={entry.image.small} alt={`Scan of the certificate “${entry.title}”`} width={96} height={96} loading="lazy" decoding="async" className="size-16 rounded-sm border border-border-subtle object-cover sm:size-24" />
        </a>
      ) : null}
      <div className="grid min-w-0 content-start gap-1">
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <KindMark kind={entry.kind} />
          <span className="text-sm text-fg-muted tabular">{entry.dateText}</span>
        </p>
        <p className="font-display text-lg [overflow-wrap:anywhere]">{entry.title}</p>
        {entry.progress && entry.progressLabel ? <ProgressMark progress={entry.progress} label={entry.progressLabel} /> : null}
        <EntryDetails entry={entry} />
        {children}
      </div>
    </div>
  );
}

function TeacherList({ teachers }: { teachers: PassportTeacherDto[] }) {
  return (
    <ul className="grid gap-3" aria-label="Teachers and periods of training">
      {teachers.map((t) => (
        <li key={`${t.person.slug}:${t.lineage}`} className="grid gap-0.5">
          <Link href={`/people/${t.person.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center font-display text-lg">
            <NameText name={t.person.name} />
          </Link>
          <p className="text-sm text-fg-muted">
            {t.lineage}
            {t.periods.length > 0 ? (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                <span className="tabular">{t.periods.map((p) => p.text).join('; ')}</span>
              </>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}

/** The "Training passport" section of a profile; nothing at all when there is nothing to show. */
export function PassportView({ passport, own, footer }: { passport: PassportDto; own: boolean; footer?: ReactNode }) {
  const hasContent = passport.currentRank !== null || passport.timeline.length > 0 || passport.experience !== null;
  if (!hasContent && !own) return null;
  // The timeline lists the current rank too, where it happened; the block on top repeats it.
  const years = timelineByYear(passport.timeline.flatMap((y) => y.items));
  return (
    <section aria-labelledby="passport-heading" className="grid scroll-mt-24 gap-5 border-t border-border-subtle pt-6" data-testid="profile-passport" data-level={passport.level}>
      <h2 id="passport-heading" tabIndex={-1} className="font-display text-2xl outline-none">
        Training passport
      </h2>
      {hasContent ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1 rounded-sm border border-border-strong p-4" data-testid="passport-current-rank">
            <dt className="eyebrow">Current rank</dt>
            {passport.currentRank ? (
              <dd className="grid gap-1">
                <span className="font-display text-xl [overflow-wrap:anywhere]">{passport.currentRank.title}</span>
                <span className="text-sm text-fg-muted tabular">
                  {passport.currentRank.dateText}
                  {passport.currentRank.organization ? ` · ${passport.currentRank.organization.name}` : ''}
                </span>
              </dd>
            ) : (
              <dd className="text-fg-muted">No rank on the record.</dd>
            )}
          </div>
          <div className="grid gap-1 rounded-sm border border-border-subtle p-4" data-testid="passport-experience">
            <dt className="eyebrow">Training</dt>
            <dd className="font-display text-xl tabular">{passport.experience ? passport.experience.text : 'Start not recorded'}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-fg-muted">Nothing in your passport is shown on your profile yet.</p>
      )}

      {passport.teachers.length > 0 ? (
        <div className="grid gap-2">
          <h3 className="font-display text-lg">Teachers</h3>
          <TeacherList teachers={passport.teachers} />
        </div>
      ) : null}

      {passport.level === 'full' && years.length > 0 ? (
        <div className="grid gap-4" data-testid="passport-timeline">
          <h3 className="font-display text-lg">Timeline</h3>
          {years.map((year) => (
            <section key={year.year ?? 'undated'} aria-labelledby={`passport-year-${year.year ?? 'undated'}`} className="grid gap-3">
              <h4 id={`passport-year-${year.year ?? 'undated'}`} className="font-display text-base tabular text-fg-muted">
                {year.year ?? 'Date not recorded'}
              </h4>
              <ol className="grid gap-4 border-l border-border-subtle pl-4">
                {year.items.map((entry) => (
                  <li key={`${entry.kind}:${entry.id}`} data-testid="passport-entry" data-kind={entry.kind}>
                    <EntryLine entry={entry} />
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : null}

      <p className="text-sm text-fg-muted">Recorded by the person’s teachers and organizations. A scanned certificate is a document they uploaded, not one this platform issues.</p>
      {footer}
    </section>
  );
}
