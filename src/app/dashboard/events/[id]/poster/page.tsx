// /dashboard/events/<id>/poster (milestone M17, In scope 5 and 6): the poster of one of the
// account's events: upload, replace or remove it (events.uploadPoster, events.removePoster). Only
// the organizer reaches it (events.editor answers 404 for any other event). Reads the session, so
// it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { EVENTS_LOAD_ERROR } from '@/components/account/load-errors/events';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { EventNotFound, EventShell } from '../../parts';
import { PosterControl } from '../../poster-control';

export const instant = false;

export const metadata: Metadata = {
  title: 'Event poster',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EventPosterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = `/dashboard/events/${encodeURIComponent(id)}/poster`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <EventNotFound />;
  const client = serverClient(await headers(), guard.principal);
  let editor;
  try {
    editor = await pageRead(client.events.editor({ id }));
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') return <EventNotFound />;
    throw error;
  }
  if (!editor || !editor.event) return <LoadError {...EVENTS_LOAD_ERROR} retryHref={page} />;
  const current = editor.event;
  return (
    <EventShell
      title={current.title}
      lead={
        <Link href={`/dashboard/events/${current.id}`} className="link inline-flex min-h-11 items-center">
          Back to the event
        </Link>
      }
    >
      {current.status === 'cancelled' ? (
        <p className="text-ui text-fg-muted">A cancelled event is not changed any more.</p>
      ) : (
        <PosterControl eventId={current.id} title={current.title} poster={current.poster} />
      )}
    </EventShell>
  );
}
