// /dashboard/events/new (milestone M17, In scope 6): publish an event. It is public at once
// (DEFAULT M17, question 2); the plan's allowance is checked when it is sent (events.create, a thin
// Server Action), and a refusal at the limit says why. "Find a city or town" first (?city=), since
// a form cannot hold another. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { EVENTS_LOAD_ERROR } from '@/components/account/load-errors/events';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CitySearch } from '../../schools/parts';
import { EventForm } from '../event-form';
import { EVENT_FORM } from '../form-ids';
import { EventShell } from '../parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Publish an event',
  robots: { index: false },
};

const PAGE = '/dashboard/events/new';

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function NewEventPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const city = typeof query.city === 'string' ? query.city.trim().slice(0, 100) || null : null;
  const client = serverClient(await headers(), guard.principal);
  const [mine, editor, initial] = await Promise.all([pageRead(client.events.mine()), pageRead(client.events.editor({ city: city ?? undefined })), readFormResult(EVENT_FORM, query.outcome)]);
  if (!mine || !editor) return <LoadError {...EVENTS_LOAD_ERROR} retryHref={PAGE} />;
  const lead = 'The event is public as soon as you publish it. Give the dates and times as they are where it happens.';
  if (!mine.publishAs.some((p) => p.canPublish)) {
    return (
      <EventShell title="Publish an event" lead={lead}>
        <div data-testid="event-cannot-publish" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
          <p className="text-ui">
            {mine.accountType !== 'sifu' && mine.publishAs.length === 0
              ? 'Events are published from a Sifu account. Your account is a Student account.'
              : (mine.allowance?.sentence ?? 'Your plan includes no publishing of events.')}
          </p>
          <Link href="/dashboard/events" className={buttonVariants({ variant: 'secondary' })}>
            Your events and your plan
            <ArrowRightIcon />
          </Link>
        </div>
      </EventShell>
    );
  }
  return (
    <EventShell title="Publish an event" lead={lead}>
      <CitySearch action={PAGE} query={city} />
      <EventForm editor={editor} publishAs={mine.publishAs} cityQuery={city} initial={initial} />
    </EventShell>
  );
}
