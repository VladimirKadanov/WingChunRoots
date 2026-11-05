// The frame of the event editor pages (milestone M17). Server components: they work without JavaScript.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { buttonVariants } from '@/components/ui/button-variants';

export function EventShell({ title, lead, children }: { title: string; lead: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/events" className="link inline-flex min-h-11 items-center">
            Your events
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{title}</h1>
        <div className="mt-3 max-w-[60ch] text-ui text-fg-muted">{lead}</div>
        <div className="mt-8 grid gap-8">{children}</div>
      </div>
    </div>
  );
}

/** The answer for an address that is not one of the account's events. */
export function EventNotFound() {
  return (
    <EventShell title="Event not found" lead="This event is not one you published, or the address is mistyped.">
      <p>
        <Link href="/dashboard/events" className={buttonVariants({ variant: 'secondary' })}>
          Your events
        </Link>
      </p>
    </EventShell>
  );
}
