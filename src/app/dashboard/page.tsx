// /dashboard (milestone M08, In scope 6; plan §5.6): what a signed-in account needs first, and
// where signing in lands (review round 1, design-7).
//   Staff:   their work first: for an administrator, the open pilot access requests (design-8).
//   Student: "My teachers" and "My requests".
//   Sifu:    "Student requests" with the approval allowance, and "My schools"; at a real limit,
//            where a request waits because of it, the upgrade prompt (<UpgradePrompt>) at the top
//            of "Student requests".
// Every list has an empty state that says why it is empty and what comes next, honestly: a link
// only where there is a real next step, and never the same label twice on one screen (design-9).
// The notifications sit beside the lists (below them on a phone) with the unread count, which the
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
import { formatDay, untilPlanEnd } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { serverClient } from '@/server/rpc/server';
import type { DashboardOverview, PersonRef } from '@/server/services/dashboard';
import { requestPilotAccessAction } from './actions';
import { Notifications, NotificationsProvider, UnreadLink } from './notifications';

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

/** Why the list is empty and what comes next; a link only where there is a real next step (plan §5.6). */
function Empty({ testId, children, action }: { testId: string; children: ReactNode; action?: { href: string; label: string } }) {
  return (
    <div data-testid={testId} className="grid justify-items-start gap-3 rounded-sm bg-surface-2 px-4 py-4">
      <p className="max-w-[56ch] text-ui text-fg-muted">{children}</p>
      {action ? (
        <Link href={action.href} className={buttonVariants({ variant: 'secondary' })}>
          {action.label}
          <ArrowRightIcon />
        </Link>
      ) : null}
    </div>
  );
}

/** The one real step for an account with a profile while requests are not open yet (M09). */
const NAME_CHECK = { href: '/account', label: 'See how your name reads' };

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
  // Without a profile the page has one call to action, "Set up your profile", above the lists.
  return (
    <>
      <Section id="teachers" title="My teachers">
        {teachers.length === 0 ? (
          <Empty testId="empty-teachers" action={overview.hasProfile ? NAME_CHECK : undefined}>
            {overview.hasProfile
              ? 'No confirmed teachers yet. Teachers find you by your name; when one confirms that they taught you, they appear here with their seal.'
              : 'Your teachers appear here once your profile is set up, so they can find you by your name and confirm you.'}
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
          <Empty testId="empty-requests">
            {overview.hasProfile
              ? 'No open requests. Requests to teachers open later in the pilot; a request you send then waits here until the teacher answers it.'
              : 'No requests yet. With a profile, you will be able to ask your teachers to confirm you once requests open later in the pilot.'}
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

function SifuLists({ overview, upgrade }: { overview: DashboardOverview; upgrade: ReactNode }) {
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
        {upgrade}
        {requests.length === 0 ? (
          <Empty testId="empty-student-requests" action={overview.hasProfile ? NAME_CHECK : undefined}>
            {overview.hasProfile
              ? 'No student requests waiting. Students find you by your name in the lineage and send you a request; it appears here.'
              : 'Student requests appear here once your profile is set up, so your students can find you by your name.'}
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
                  status={<StatusBadge state="unconfirmed" label="Sent to you" />}
                />
              ))}
            </ul>
            <p className="text-sm text-fg-muted">Approving and declining requests opens with teacher requests, later in the pilot. Until then they stay here.</p>
          </>
        )}
      </Section>
      <Section id="schools" title="My schools">
        {schools.length === 0 ? (
          <Empty testId="empty-schools">
            No school lists you as an instructor yet. Schools and the map open later in the pilot; a school that lists you then appears here.
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

/** Staff work first (review round 1, design-8): for an administrator, the open pilot access requests. */
function StaffWork({ staff }: { staff: NonNullable<DashboardOverview['staff']> }) {
  const open = staff.openPilotRequests;
  return (
    <Section id="staff" title="Staff work">
      {open === null ? (
        <div data-testid="staff-work" className="grid justify-items-start gap-3">
          <p className="max-w-[56ch] text-ui text-fg-muted">The review and moderation tools arrive in later milestones of the pilot.</p>
          <Link href="/admin" className={buttonVariants({ variant: 'secondary' })}>
            Administration
            <ArrowRightIcon />
          </Link>
        </div>
      ) : (
        <div data-testid="staff-work" className="grid justify-items-start gap-3">
          {open === 0 ? (
            <p data-testid="open-pilot-requests" className="max-w-[56ch] text-ui text-fg-muted">
              No pilot access request is waiting for an answer.
            </p>
          ) : (
            <p data-testid="open-pilot-requests" className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-display text-3xl leading-none tabular">{open}</span>
              <span className="text-ui">{open === 1 ? 'open pilot access request' : 'open pilot access requests'}</span>
            </p>
          )}
          <Link href={open > 0 ? '/admin/grants#pilot-requests' : '/admin/grants'} className={buttonVariants({ variant: 'secondary' })}>
            {open > 0 ? 'Answer them in Plan grants' : 'Plan grants'}
            <ArrowRightIcon />
          </Link>
        </div>
      )}
    </Section>
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
  const offer = overview.sifu?.upgrade ?? null;
  const sifu = overview.accountType === 'sifu';
  const instructorBadge =
    overview.instructor.status === 'verified' ? 'verified' : overview.instructor.status === 'unverified' ? 'unconfirmed' : null;
  // A staff account without a profile has no teachers or students: one quiet line, no lists.
  const staffOnly = overview.staff !== null && !overview.hasProfile;

  return (
    <NotificationsProvider list={overview.notifications}>
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
                {sifu ? 'Sifu' : 'Student'}
              </dd>
            </div>
            {sifu ? (
              <div className="grid gap-0.5">
                <dt className="text-sm text-fg-muted">Shown as</dt>
                <dd data-testid="shown-as" className="text-ui font-semibold">
                  {instructorBadge ? <StatusBadge state={instructorBadge} label={overview.instructor.label} /> : overview.instructor.label}
                </dd>
              </div>
            ) : null}
            <div className="grid gap-0.5">
              <dt className="text-sm text-fg-muted">Plan</dt>
              <dd data-testid="plan-name" className="text-ui font-semibold">
                {overview.plan.name}
                {overview.until ? <span className="font-normal text-fg-muted"> {untilPlanEnd(overview.until)}</span> : null}
              </dd>
            </div>
          </dl>
          <p className="mt-4 flex flex-wrap gap-x-5 text-sm">
            <Link href="/dashboard/settings" className="link inline-flex min-h-11 items-center">
              Account type and plan
            </Link>
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              Account and security
            </Link>
            <Link href="/plans" className="link inline-flex min-h-11 items-center">
              Compare plans
            </Link>
            <UnreadLink />
          </p>
        </header>

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-14">
          <div className="grid content-start gap-10">
            {overview.staff ? <StaffWork staff={overview.staff} /> : null}

            {staffOnly ? (
              <p data-testid="staff-no-profile" className="max-w-[56ch] text-ui text-fg-muted">
                Staff accounts don&apos;t need a profile;{' '}
                <Link href={ONBOARDING} className="link">
                  add one in onboarding
                </Link>{' '}
                if you also train.
              </p>
            ) : overview.hasProfile ? null : (
              <div className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
                <p className="text-ui">Your profile is not set up yet. Add your name so teachers and students can find and confirm you.</p>
                <Link href={ONBOARDING} className={cx(buttonVariants({ variant: 'primary', size: 'lg' }))}>
                  Set up your profile
                  <ArrowRightIcon />
                </Link>
              </div>
            )}

            {staffOnly ? null : sifu ? (
              <SifuLists
                overview={overview}
                upgrade={
                  offer ? (
                    <UpgradePrompt
                      offer={offer}
                      requestAction={requestPilotAccessAction}
                      notNowHref="/dashboard#student-requests"
                      initial={await readFormResult('pilot-access', query.outcome)}
                    />
                  ) : null
                }
              />
            ) : (
              <StudentLists overview={overview} />
            )}
          </div>
          <Notifications />
        </div>
      </div>
    </NotificationsProvider>
  );
}
