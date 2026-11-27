// Journey review P2-5 (docs/adr/0082-organization-overview.md): the organizations the account
// administers, first on the dashboard home: members, linked schools, schools that have not
// answered, the next event, the plan and what is left to do. A Server Component.

import Link from 'next/link';

import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import type { OrganizationOverview } from '@/server/services/organization-overview';

function eventDate(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
  }
}

function Figure({ value, label, testId }: { value: number; label: string; testId: string }) {
  return (
    <div className="grid gap-0.5" data-testid={testId}>
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="font-display text-2xl leading-none tabular">{value}</dd>
    </div>
  );
}

export function OrganizationsGlance({ overview }: { overview: OrganizationOverview }) {
  if (overview.organizations.length === 0) return null;
  return (
    <section aria-labelledby="org-glance-heading" className="grid content-start gap-6 border-t border-border-subtle pt-6" data-testid="organizations-glance">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="org-glance-heading" className="font-display text-2xl">
          {overview.organizations.length === 1 ? 'Your organization' : 'Your organizations'}
        </h2>
        {overview.total > overview.organizations.length ? (
          <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center text-sm">
            All {overview.total} organizations
          </Link>
        ) : null}
      </header>
      {overview.organizations.map((org) => (
        <article key={org.id} aria-labelledby={`org-${org.id}-name`} className="grid gap-4 rounded-md border border-border-subtle bg-surface-1 p-5" data-testid="organization-glance">
          <header className="grid gap-1">
            <h3 id={`org-${org.id}-name`} className="font-display text-xl [overflow-wrap:anywhere]">
              <Link href={`/dashboard/organization/${org.id}`} className="link">
                {org.name}
              </Link>
            </h3>
            <p className="text-sm text-fg-muted">
              {org.roleLabel} · {org.approved ? org.planLabel : org.approvalLabel}
            </p>
          </header>
          {org.approved ? (
            <dl className="flex flex-wrap gap-x-8 gap-y-3">
              <Figure value={org.members} label={org.members === 1 ? 'Member' : 'Members'} testId="glance-members" />
              <Figure value={org.schoolsLinked} label={org.schoolsLinked === 1 ? 'Linked school' : 'Linked schools'} testId="glance-schools" />
              {org.schoolsWaiting > 0 ? (
                <Figure value={org.schoolsWaiting} label={org.schoolsWaiting === 1 ? 'School has not answered' : 'Schools have not answered'} testId="glance-waiting" />
              ) : null}
            </dl>
          ) : null}
          {org.nextEvent ? (
            <p className="text-ui" data-testid="glance-next-event">
              <span className="text-fg-muted">Next event: </span>
              <Link href={`/events/${org.nextEvent.slug}`} className="link">
                {org.nextEvent.title}
              </Link>
              , {eventDate(org.nextEvent.startsAt, org.nextEvent.timezone)}
            </p>
          ) : null}
          {org.todo.length > 0 ? (
            <div className="grid gap-2" data-testid="glance-todo">
              <h4 className="text-sm font-semibold">To do</h4>
              <ul className="grid gap-1">
                {org.todo.map((item) => (
                  <li key={item.key} data-key={item.key}>
                    <Link href={item.href} className="link inline-flex min-h-11 items-center gap-2 text-ui">
                      {item.label}
                      <ArrowRightIcon />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <p>
            <Link href={`/dashboard/organization/${org.id}`} className={buttonVariants({ variant: 'secondary' })}>
              Manage {org.name}
            </Link>
          </p>
        </article>
      ))}
    </section>
  );
}
