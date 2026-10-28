'use client';

// A teacher's students in the panel (plan §4.8; milestone M06, package C): orpc.people.students in
// pages of 20 (DEFAULT, no D number), Previous and Next, active students first and then those whose
// training ended (the M04 list's order), each name a link to the profile with an "Explore from here"
// link, all at least 44 px tall. The summary node "and N more" opens it, and "+N students" beyond
// the cap. Previous and Next stay in place on the first and the last page (aria-disabled), so the
// focus never falls out of the list while paging.
//
// The pages are people.students answers read through the oRPC client and the explorer's query
// client by expand.ts (useExpansions gives the reader; expand-state.ts readStudents), so a page
// read once comes from the cache: this chunk imports neither TanStack Query nor the oRPC client
// (expand-state.ts says why).

import Link from 'next/link';
import { type ReactNode, useEffect, useState } from 'react';

import { cx } from '@/lib/cx';
import type { StudentEntryDto, StudentsPageDto } from '@/server/dto/public';

import { studentTotalsText } from '../status';
import { readStudents } from './expand-state';

/** Students per page of the panel's list (DEFAULT, no D number). */
export const STUDENTS_PER_PAGE = 20;

export interface StudentsListProps {
  /** The teacher whose students are listed. */
  teacherId: string;
  slug: string;
  name: string;
}

function Row({ entry, note }: { entry: StudentEntryDto; note: string | null }) {
  const person = entry.person;
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 border-b border-border-subtle last:border-b-0">
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <Link href={`/people/${person.slug}`} prefetch={false} className="link inline-flex min-h-11 items-center text-ui">
          <span lang="und-Latn" translate="no">
            {person.displayName}
          </span>
        </Link>
        {note ? <span className="text-sm text-fg-muted">{note}</span> : null}
      </span>
      <Link
        href={`/explore?focus=${person.id}`}
        prefetch={false}
        aria-label={`Explore from here: ${person.displayName}`}
        className="link inline-flex min-h-11 shrink-0 items-center text-sm"
      >
        Explore from here
      </Link>
    </li>
  );
}

export function StudentsList({ slug, name }: StudentsListProps): ReactNode {
  const [page, setPage] = useState(1);
  const [attempt, setAttempt] = useState(0);
  // The page asked for (and the attempt: Retry asks again).
  const of = `${slug} ${page} ${attempt}`;
  // The last page read, which stays on screen while the next one is read (aria-busy), and the ask that failed.
  const [shown, setShown] = useState<{ of: string; data: StudentsPageDto } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    readStudents({ slug, page, pageSize: STUDENTS_PER_PAGE }).then(
      (data) => {
        if (current) setShown({ of, data });
      },
      () => {
        if (current) setFailed(of);
      },
    );
    return () => {
      current = false;
    };
  }, [slug, page, of]);
  if (failed === of) {
    return (
      <p role="alert" className="text-ui">
        The students could not be loaded.{' '}
        <button type="button" className="link inline-flex min-h-11 items-center" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </p>
    );
  }
  const data = shown?.data;
  if (!data) {
    return (
      <p role="status" className="text-sm text-fg-muted">
        Loading the students…
      </p>
    );
  }
  const busy = shown?.of !== of;
  const total = data.activeTotal + data.historicalTotal;
  const pageButton = (label: 'Previous' | 'Next', to: number, enabled: boolean) => (
    <button
      type="button"
      aria-disabled={!enabled || undefined}
      onClick={() => {
        if (enabled) setPage(to);
      }}
      className={cx('link inline-flex min-h-11 items-center text-ui', !enabled && 'cursor-default text-fg-subtle no-underline')}
    >
      {label}
    </button>
  );
  return (
    <div className="grid gap-2" aria-busy={busy || undefined}>
      <p className="text-sm text-fg-muted">
        {studentTotalsText(data.activeTotal, data.historicalTotal)}
        {total > 0 ? ', by name' : ''}.
      </p>
      {total === 0 && data.own.length === 0 ? null : (
        <ol aria-label={`Students of ${name}, page ${data.page}`} className="grid">
          {/* DEFAULT D03: the signed-in teacher's own requests, on page 1 only, never counted. */}
          {data.own.map((entry) => (
            <Row key={entry.person.id} entry={entry} note="Visible only to you and them" />
          ))}
          {data.active.map((entry) => (
            <Row key={entry.person.id} entry={entry} note={null} />
          ))}
          {data.historical.map((entry) => (
            <Row key={entry.person.id} entry={entry} note="Training ended" />
          ))}
        </ol>
      )}
      {data.pageCount > 1 ? (
        <nav aria-label="Pages of students" className="flex flex-wrap items-center gap-x-4">
          {pageButton('Previous', data.page - 1, data.page > 1)}
          <span role="status" className="text-sm text-fg-muted tabular-nums">
            Page {data.page} of {data.pageCount}
          </span>
          {pageButton('Next', data.page + 1, data.page < data.pageCount)}
        </nav>
      ) : null}
    </div>
  );
}
