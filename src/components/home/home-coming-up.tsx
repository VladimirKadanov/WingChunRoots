// The home page's "Coming up" (role replay 2026-11-25, P3-4): the next three public events from
// events.list, the same public DTO as the calendar. The home page stays prerendered: this part
// reads per request and streams in behind <Suspense>, with ComingUpFallback (the same frame, no
// rows) in its place until then. Nothing in it is private: v_public_event only.

import Link from 'next/link';
import { headers } from 'next/headers';
import { connection } from 'next/server';

import { EventRow } from '@/components/events/event-list';
import { ArrowRightIcon } from '@/components/icons';
import type { EventListDto } from '@/server/dto/events';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

export const COMING_UP = 3;

function Frame({ children, state }: { children: React.ReactNode; state: 'loading' | 'shown' | 'none' | 'failed' }) {
  return (
    <section aria-labelledby="coming-up-heading" data-testid="home-coming-up" data-state={state} className="grid gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id="coming-up-heading" className="font-display text-xl">
          Coming up
        </h3>
        <Link href="/events" className="link inline-flex min-h-11 items-center gap-1.5 text-sm">
          All events
          <ArrowRightIcon size={16} />
        </Link>
      </div>
      {children}
    </section>
  );
}

export function ComingUpFallback() {
  return (
    <Frame state="loading">
      <p className="min-h-24 text-sm text-fg-subtle">Loading the next events…</p>
    </Frame>
  );
}

export async function HomeComingUp() {
  await connection();
  let list: EventListDto | null = null;
  try {
    list = await serverClient(await headers(), await getRequestPrincipal()).events.list({ when: 'upcoming', limit: COMING_UP });
  } catch (error) {
    console.error(`[home] the next events could not be loaded: ${error instanceof Error ? error.name : 'unknown'}`);
  }
  if (!list) {
    return (
      <Frame state="failed">
        <p className="text-sm text-fg-muted">The next events could not be loaded just now. The calendar has all of them.</p>
      </Frame>
    );
  }
  if (list.items.length === 0) {
    return (
      <Frame state="none">
        <p className="text-sm text-fg-muted">No events are announced yet. Seminars, gradings and open classes appear here when a school or teacher publishes one.</p>
      </Frame>
    );
  }
  return (
    <Frame state="shown">
      <ul className="grid border-t border-border-subtle">
        {list.items.map((event) => (
          <EventRow key={event.slug} event={event} headingLevel={4} />
        ))}
      </ul>
    </Frame>
  );
}
