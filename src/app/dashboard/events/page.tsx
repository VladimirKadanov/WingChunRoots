// /dashboard/events (milestone M17, In scope 6; plan §5.6): the events the account published, as a
// Sifu or for an organization it administers, and what its plan allows: Professional Sifu up to 3
// events that start in a calendar month (DEFAULT M17, question 1), counted in each event's own zone,
// shown month by month; an organization with Federation without a limit (DEFAULT D25). The upgrade
// prompt shows only at the real limit, a plan without publishing (Free Sifu), and only with benefits
// that exist now (plan §6.5). A Student account is told events come from a Sifu account. Reads the
// session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { EVENTS_LOAD_ERROR } from '@/components/account/load-errors/events';
import { PageRedirect } from '@/components/account/page-redirect';
import { CancelledMark } from '@/components/events/event-list';
import { ArrowRightIcon, PlusIcon } from '@/components/icons';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { MyEventItem } from '@/server/services/events';
import { requestPilotAccessAction } from '../actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your events',
  robots: { index: false },
};

const PAGE = '/dashboard/events';

type Search = Promise<Record<string, string | string[] | undefined>>;

function Row({ item }: { item: MyEventItem }) {
  return (
    <li className="grid gap-1 border-b border-border-subtle py-4" data-testid="my-event" data-status={item.status}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-label uppercase text-fg-muted">
        <span>{item.kindLabel}</span>
        {item.status === 'cancelled' ? <CancelledMark /> : item.status === 'removed' ? <span className="font-semibold text-danger">{item.statusLabel}</span> : <span>{item.statusLabel}</span>}
        {item.organizationName ? <span>For {item.organizationName}</span> : null}
      </p>
      <p className="font-display text-lg [overflow-wrap:anywhere]">
        {item.status === 'removed' ? (
          item.title
        ) : (
          <Link href={`${PAGE}/${item.id}`} className="link inline-flex min-h-11 items-center">
            {item.title}
          </Link>
        )}
      </p>
      <p className="text-sm text-fg-muted">
        {item.when} · {item.place}
      </p>
      {item.status !== 'removed' ? (
        <p className="text-sm">
          <Link href={`/events/${item.slug}`} className="link inline-flex min-h-11 items-center">
            Public page
          </Link>
        </p>
      ) : null}
    </li>
  );
}

export default async function EventsDashboardPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const mine = await pageRead(client.events.mine());
  if (!mine) return <LoadError {...EVENTS_LOAD_ERROR} retryHref={PAGE} />;
  const canPublish = mine.publishAs.some((p) => p.canPublish);
  const upcoming = mine.events.filter((e) => e.upcoming);
  const past = mine.events.filter((e) => !e.upcoming);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your events</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Seminars, camps, exam sessions and other events. An event is public as soon as you publish it; you can change or cancel it later.
        </p>

        <div className="mt-8 grid gap-6">
          {mine.accountType !== 'sifu' && mine.publishAs.length === 0 ? (
            <div data-testid="events-needs-sifu" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">Events are published from a Sifu account. Your account is a Student account.</p>
              <Link href="/events" className={buttonVariants({ variant: 'secondary' })}>
                Browse the calendar
                <ArrowRightIcon />
              </Link>
            </div>
          ) : mine.accountType === 'sifu' && !mine.hasProfile && mine.publishAs.length === 0 ? (
            <div data-testid="events-needs-profile" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">An event names you as its organizer, so your profile comes first.</p>
              <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className={buttonVariants({ variant: 'secondary' })}>
                Set up your profile
                <ArrowRightIcon />
              </Link>
            </div>
          ) : null}

          {mine.allowance ? (
            <section aria-labelledby="events-allowance" className="grid gap-2" data-testid="events-allowance">
              <h2 id="events-allowance" className="font-display text-xl">
                {mine.allowance.planName}
              </h2>
              <p className="text-ui text-fg-muted">{mine.allowance.sentence}</p>
              {mine.allowance.included && mine.allowance.limit !== null ? (
                <ul className="grid gap-1 text-sm" data-testid="events-months">
                  {mine.allowance.months.map((m) => (
                    <li key={m.month} data-month={m.month} data-remaining={m.remaining ?? ''}>
                      <span className="font-semibold">{m.label}:</span> {m.used} of {m.limit} published
                      {m.remaining === 0 ? ' · the allowance of this month is used' : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {mine.upgrade ? (
            <UpgradePrompt
              offer={mine.upgrade}
              requestAction={requestPilotAccessAction}
              notNowAction={PAGE}
              closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
              expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
            />
          ) : null}

          {mine.publishAs
            .filter((p) => p.kind === 'organization' && !p.canPublish)
            .map((p) => (
              <p key={p.id} className="text-sm text-fg-muted" data-testid="organization-needs-federation">
                {p.name}: {p.note}
              </p>
            ))}

          {canPublish ? (
            <p>
              <Link href={`${PAGE}/new`} className={buttonVariants({ variant: 'primary' })} data-testid="new-event">
                <PlusIcon />
                Publish an event
              </Link>
            </p>
          ) : null}

          <section aria-labelledby="events-upcoming">
            <h2 id="events-upcoming" className="font-display text-xl">
              Upcoming
            </h2>
            {upcoming.length === 0 ? (
              <p className="mt-2 text-fg-muted" data-testid="no-my-events">
                You have no upcoming event.
              </p>
            ) : (
              <ul className="mt-2 grid" data-testid="my-events">
                {upcoming.map((e) => (
                  <Row key={e.id} item={e} />
                ))}
              </ul>
            )}
          </section>
          {past.length > 0 ? (
            <section aria-labelledby="events-past">
              <h2 id="events-past" className={cx('font-display text-xl')}>
                Past
              </h2>
              <ul className="mt-2 grid">
                {past.map((e) => (
                  <Row key={e.id} item={e} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
