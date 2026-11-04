// /dashboard/events/<id> (milestone M17, In scope 6): one of the account's events (its own, or an
// organization's it administers): change it, its poster, or cancel it. Only the organizer reaches
// it (events.editor answers 404 for any other event, one answer for all). A cancelled event is
// shown, not changed. The poster has a page of its own (./poster), which loads the upload control. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { EVENTS_LOAD_ERROR } from '@/components/account/load-errors/events';
import { PageRedirect } from '@/components/account/page-redirect';
import { CancelledMark } from '@/components/events/event-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CitySearch } from '../../schools/parts';
import { CancelEventForm } from '../cancel-form';
import { EventForm } from '../event-form';
import { EVENT_CANCEL_FORM, EVENT_FORM } from '../form-ids';
import { EventNotFound, EventShell } from '../parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your event',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const DONE: Record<string, string> = {
  published: 'The event is published: it is in the calendar now.',
  saved: 'Your changes are saved and public.',
  cancelled: 'The event is cancelled. It stays in the calendar, marked Cancelled.',
};

export default async function EventEditPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = `/dashboard/events/${encodeURIComponent(id)}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <EventNotFound />;
  const query = await searchParams;
  const city = typeof query.city === 'string' ? query.city.trim().slice(0, 100) || null : null;
  const client = serverClient(await headers(), guard.principal);
  let editor;
  try {
    editor = await pageRead(client.events.editor({ id, city: city ?? undefined }));
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') return <EventNotFound />;
    throw error;
  }
  if (!editor || !editor.event) return <LoadError {...EVENTS_LOAD_ERROR} retryHref={page} />;
  const current = editor.event;
  const [formOutcome, cancelOutcome] = await Promise.all([readFormResult(EVENT_FORM, query.outcome), readFormResult(EVENT_CANCEL_FORM, query.outcome)]);
  const done = Object.keys(DONE).find((k) => query[k] === '1');
  const cancelled = current.status === 'cancelled';

  return (
    <EventShell
      title={current.title}
      lead={
        <span className="flex flex-wrap items-center gap-x-3">
          {cancelled ? <CancelledMark /> : <span>Published</span>}
          <Link href={`/events/${current.slug}`} className="link inline-flex min-h-11 items-center">
            Public page
          </Link>
        </span>
      }
    >
      {done ? (
        <p id="outcome" role="status" tabIndex={-1} className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="event-done">
          {DONE[done]}
        </p>
      ) : null}
      {cancelled ? (
        <p className="text-ui text-fg-muted">A cancelled event is not changed any more. Publish a new event for a new date.</p>
      ) : (
        <>
          <section aria-labelledby="event-poster" className="grid gap-2">
            <h2 id="event-poster" className="font-display text-xl">
              Poster
            </h2>
            <p className="text-sm text-fg-muted">{current.poster ? 'The event has a poster.' : 'The event has no poster yet.'}</p>
            <p>
              <Link href={`/dashboard/events/${current.id}/poster`} className={buttonVariants({ variant: 'secondary' })} data-testid="event-poster-link">
                {current.poster ? 'Change the poster' : 'Add a poster'}
              </Link>
            </p>
          </section>
          <section aria-labelledby="event-edit" className="grid gap-4">
            <h2 id="event-edit" className="font-display text-xl">
              Details
            </h2>
            <CitySearch action={page} query={city} />
            <EventForm editor={editor} publishAs={[]} cityQuery={city} initial={formOutcome} />
          </section>
          <section aria-labelledby="event-cancel" className="grid gap-3 border-t border-border-subtle pt-6">
            <h2 id="event-cancel" className="font-display text-xl">
              Cancel the event
            </h2>
            <CancelEventForm id={current.id} initial={cancelOutcome} />
          </section>
        </>
      )}
    </EventShell>
  );
}
