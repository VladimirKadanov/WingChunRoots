// /dashboard (milestone M08, In scope 6; plan §5.6): what a signed-in account needs first.
//   Student: "My teachers" and "My requests".
//   Sifu:    "Student requests" with the approval allowance, and "My schools"; at a real limit,
//            where a request waits because of it, the upgrade prompt (<UpgradePrompt>).
// Every list has an empty state that says why it is empty and names the next action. The
// notifications sit beside the lists (below them on a phone) with the unread count, which the
// header repeats. The data comes from the dashboard.overview and account.me procedures (the same
// ones /api/v1 serves). Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { NameLine, NameText } from '@/components/account/person-names';
import { ArrowRightIcon, PinIcon } from '@/components/icons';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBadge } from '@/components/ui/status-badge';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { serverClient } from '@/server/rpc/server';
import type { DashboardOverview, PersonRef } from '@/server/services/dashboard';
import { requestPilotAccessAction } from './actions';
import { Notifications } from './notifications';

export const instant = false;

export const metadata: Metadata = {
  title: 'Dashboard',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const ONBOARDING = '/onboarding?next=%2Fdashboard';

function Section({ id, title, aside, children }: { id: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-3 border-t border-border-subtle pt-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-heading`} className="font-display text-2xl">
          {title}
        </h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/** Why the list is empty, and the next real action (plan §5.6). */
function Empty({ testId, children, action }: { testId: string; children: ReactNode; action: { href: string; label: string } }) {
  return (
    <div data-testid={testId} className="grid justify-items-start gap-3 rounded-sm bg-surface-2 px-4 py-4">
      <p className="max-w-[56ch] text-ui text-fg-muted">{children}</p>
      <Link href={action.href} className={buttonVariants({ variant: 'secondary' })}>
        {action.label}
        <ArrowRightIcon />
      </Link>
    </div>
  );
}

function Person({ person }: { person: PersonRef }) {
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-[0.42em] font-display text-lg [overflow-wrap:anywhere]">
      <NameText name={person.name} />
      {person.original ? <NameText name={person.original} className="text-[0.78em] text-fg-muted" /> : null}
    </span>
  );
}

function Row({ person, meta, status }: { person: PersonRef; meta: ReactNode; status: ReactNode }) {
  return (
    <li className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-4">
      <span className="grid gap-0.5">
        <Person person={person} />
        <span className="text-sm text-fg-muted">{meta}</span>
      </span>
      <span className="text-sm">{status}</span>
    </li>
  );
}

function StudentLists({ overview }: { overview: DashboardOverview }) {
  const { teachers, requests } = overview.student!;
  const next = overview.hasProfile
    ? { href: '/', label: 'Explore the lineage' }
    : { href: ONBOARDING, label: 'Set up your profile' };
  return (
    <>
      <Section id="teachers" title="My teachers">
        {teachers.length === 0 ? (
          <Empty testId="empty-teachers" action={next}>
            {overview.hasProfile
              ? 'No confirmed teachers yet. When a teacher confirms that they taught you, they appear here with their seal.'
              : 'No teachers yet: first set up your profile with your name, so your teachers can confirm you.'}
          </Empty>
        ) : (
          <ul data-testid="teachers" className="grid">
            {teachers.map((item) => (
              <Row key={item.relationshipId} person={item.teacher} meta={item.lineage} status={<StatusBadge state={item.badge} label={item.statusLabel} />} />
            ))}
          </ul>
        )}
      </Section>
      <Section id="requests" title="My requests">
        {requests.length === 0 ? (
          <Empty testId="empty-requests" action={next}>
            {overview.hasProfile
              ? 'No open requests. A request you send to a teacher waits here until they answer it.'
              : 'No requests yet. With a profile you can ask your teachers to confirm you.'}
          </Empty>
        ) : (
          <ul data-testid="requests" className="grid">
            {requests.map((item) => (
              <Row
                key={item.relationshipId}
                person={item.teacher}
                meta={
                  <>
                    {item.lineage} · sent {formatDay(item.createdAt)}
                  </>
                }
                status={<StatusBadge state={item.badge} label={item.statusLabel} />}
              />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function SifuLists({ overview }: { overview: DashboardOverview }) {
  const { requests, students, schools } = overview.sifu!;
  const allowance =
    students.limit === null
      ? `${students.approved} approved, no limit on ${overview.plan.name}`
      : `${students.approved} of ${students.limit} approved on ${overview.plan.name}`;
  return (
    <>
      <Section
        id="student-requests"
        title="Student requests"
        aside={
          <span data-testid="student-allowance" className="text-sm text-fg-muted">
            Students: {allowance}
          </span>
        }
      >
        {requests.length === 0 ? (
          <Empty testId="empty-student-requests" action={overview.hasProfile ? { href: '/account', label: 'Check your profile' } : { href: ONBOARDING, label: 'Set up your profile' }}>
            {overview.hasProfile
              ? 'No student requests waiting. Students find you by your name in the lineage and send you a request; it appears here.'
              : 'No student requests yet. Set up your profile with your name, so your students can find you.'}
          </Empty>
        ) : (
          <>
            <ul data-testid="student-requests" className="grid">
              {requests.map((item) => (
                <Row
                  key={item.relationshipId}
                  person={item.student}
                  meta={
                    <>
                      {item.lineage} · sent {formatDay(item.createdAt)}
                    </>
                  }
                  status={<StatusBadge state="unconfirmed" label="Waiting for you" />}
                />
              ))}
            </ul>
            <p className="text-sm text-fg-muted">Approving and declining requests opens with teacher requests, later in the pilot.</p>
          </>
        )}
      </Section>
      <Section id="schools" title="My schools">
        {schools.length === 0 ? (
          <Empty testId="empty-schools" action={{ href: '/plans#instructors', label: 'How schools appear on the map' }}>
            No school lists you as an instructor yet. Schools and the map open later in the pilot; a school then lists its instructors.
          </Empty>
        ) : (
          <ul data-testid="schools" className="grid">
            {schools.map((item) => (
              <li key={item.id} className="grid gap-1 border-b border-border-subtle py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-baseline sm:gap-x-4">
                <span className="grid gap-0.5">
                  <span className="font-display text-lg [overflow-wrap:anywhere]">{item.name}</span>
                  <span className="flex items-center gap-1.5 text-sm text-fg-muted">
                    <PinIcon size={16} />
                    {item.city}, {item.countryCode} · {item.roleLabel}
                  </span>
                </span>
                <span className="text-sm">{item.statusLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

export default async function DashboardPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/dashboard');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const [overview, me] = await Promise.all([client.dashboard.overview(), client.account.me()]);
  const names = me.person?.names ?? [];
  const primary = names.find((name) => name.isPrimary);
  const original = names.find((name) => !name.isPrimary && name.kind !== 'romanization');
  const upgrade = overview.sifu?.upgrade ?? null;
  const later = query.upgrade === 'later';
  const unread = overview.notifications.unread;
  const instructorBadge =
    overview.instructor.status === 'verified' ? 'verified' : overview.instructor.status === 'unverified' ? 'unconfirmed' : null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <header className="max-w-[46rem]">
        <p className="eyebrow">Dashboard</p>
        <h1 className="mt-2 text-feature [overflow-wrap:anywhere]">
          {primary ? <NameLine primary={primary.value} original={original} /> : <span className="font-display">Your dashboard</span>}
        </h1>
        <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-3">
          <div className="grid gap-0.5">
            <dt className="text-sm text-fg-muted">Account type</dt>
            <dd data-testid="account-type" className="text-ui font-semibold">
              {instructorBadge ? <StatusBadge state={instructorBadge} label={overview.instructor.label} /> : overview.instructor.label}
            </dd>
          </div>
          <div className="grid gap-0.5">
            <dt className="text-sm text-fg-muted">Plan</dt>
            <dd data-testid="plan-name" className="text-ui font-semibold">
              {overview.plan.name}
              {overview.until ? <span className="font-normal text-fg-muted"> until {formatDay(overview.until)}</span> : null}
            </dd>
          </div>
        </dl>
        <p className="mt-4 flex flex-wrap gap-x-5 text-sm">
          <Link href="/dashboard/settings" className="link inline-flex min-h-11 items-center">
            Account type and plan
          </Link>
          <Link href="/plans" className="link inline-flex min-h-11 items-center">
            Compare plans
          </Link>
          {unread > 0 ? (
            <Link href="#notifications" className="link inline-flex min-h-11 items-center">
              {unread === 1 ? '1 unread notification' : `${unread} unread notifications`}
            </Link>
          ) : null}
        </p>
      </header>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-14">
        <div className="grid content-start gap-10">
          {overview.hasProfile ? null : (
            <div className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">Your profile is not set up yet. Add your name so teachers and students can find and confirm you.</p>
              <Link href={ONBOARDING} className={cx(buttonVariants({ variant: 'primary', size: 'lg' }))}>
                Set up your profile
                <ArrowRightIcon />
              </Link>
            </div>
          )}

          {upgrade ? (
            later ? (
              <p data-testid="upgrade-later" className="flex flex-wrap items-center gap-x-4 rounded-sm bg-surface-2 px-4 py-2 text-sm">
                <span>{upgrade.allowance.sentence}</span>
                <Link href="/dashboard#upgrade" className="link inline-flex min-h-11 items-center">
                  Show the options
                </Link>
              </p>
            ) : (
              <UpgradePrompt
                offer={upgrade}
                requestAction={requestPilotAccessAction}
                notNowHref="/dashboard?upgrade=later"
                initial={await readFormResult('pilot-access', query.outcome)}
              />
            )
          ) : null}

          {overview.accountType === 'student' ? <StudentLists overview={overview} /> : <SifuLists overview={overview} />}
        </div>
        <Notifications list={overview.notifications} />
      </div>
    </div>
  );
}
