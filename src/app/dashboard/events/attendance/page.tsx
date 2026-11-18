// /dashboard/events/attendance (owner decision 2026-11-18, docs/adr/0046-passport-extras.md): the
// attendance requests waiting on events this account organized or taught at, or that an
// organization it administers organized. "Confirm" adds the event to the student's passport
// ("Confirmed by the organizer"); "Refuse" keeps the request, shown to nobody. The student is
// named by their primary name, with their page only while it is public. Data from
// passport.attendanceClaims; decisions through a thin Server Action and /api/rpc. Reads the
// session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { DecideForm } from './decide-form';
import { ATTENDANCE_DECIDE_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Attendance requests',
  robots: { index: false },
};

const PAGE = '/dashboard/events/attendance';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function AttendanceRequestsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const data = await pageRead(client.passport.attendanceClaims());
  if (!data) {
    return (
      <LoadError
        eyebrow="Your events"
        title="Attendance requests"
        message="We couldn't load the requests. Nothing was changed."
        retryHref={PAGE}
        back={{ href: '/dashboard/events', label: 'Back to your events' }}
      />
    );
  }
  const outcome = await readFormResult(ATTENDANCE_DECIDE_FORM, query.outcome);
  const notice =
    query.confirmed === '1'
      ? 'Confirmed. The event is in the student’s passport now.'
      : query.refused === '1'
        ? 'Refused. The request is kept and shown to nobody.'
        : null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/events" className="link inline-flex min-h-11 items-center">
            Your events
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Attendance requests</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Students who say they attended an event you organized or taught at. Confirm only someone you know took part: a confirmed event shows in their training
          passport as confirmed by the organizer.
        </p>
        {notice ? (
          <p role="status" className="mt-4 text-ui font-semibold" data-testid="attendance-notice">
            {notice}
          </p>
        ) : null}

        <section aria-labelledby="attendance-waiting" className="mt-8 grid gap-3">
          <h2 id="attendance-waiting" className="font-display text-2xl">
            Waiting for you <span className="text-fg-muted tabular">· {data.claims.length}</span>
          </h2>
          {data.claims.length === 0 ? (
            <p className="text-ui text-fg-muted" data-testid="attendance-none">
              No requests are waiting.
            </p>
          ) : (
            <ul className="grid" aria-label="Attendance requests, the oldest first">
              {data.claims.map((c) => {
                const name = (
                  <span lang={c.student.name.lang ?? undefined} translate="no">
                    {c.student.name.value}
                  </span>
                );
                return (
                  <li key={c.id} className="grid gap-2 border-b border-border-subtle py-4" data-testid="attendance-claim">
                    <p className="font-display text-lg [overflow-wrap:anywhere]">
                      {c.student.slug ? (
                        <Link href={`/people/${c.student.slug}`} className="link inline-flex min-h-11 items-center">
                          {name}
                        </Link>
                      ) : (
                        name
                      )}
                    </p>
                    <p className="text-sm text-fg-muted">
                      Says they attended{' '}
                      <Link href={`/events/${c.event.slug}`} className="link">
                        {c.event.title}
                      </Link>{' '}
                      · <span className="tabular">{c.event.dateText}</span>
                    </p>
                    <DecideForm id={c.id} label={`${c.student.name.value} at ${c.event.title}`} initial={outcome?.values?.id === c.id ? outcome : null} />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
