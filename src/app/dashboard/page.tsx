// /dashboard (milestone M08, In scope 6; plan §5.6): what a signed-in account needs first, and
// where signing in lands (review round 1, design-7).
//   Staff:   their work first: for an administrator, the open pilot access requests (design-8),
//            once the session has passed the second factor (review round 2, recheck-1).
//   Student: "My teachers" and "My requests", with "Name a teacher" (/dashboard/teachers/new, M09).
//   Sifu:    "Student requests" with the approval allowance, and "My schools"; at a real limit,
//            where a request waits because of it, the upgrade prompt (<UpgradePrompt>) at the top
//            of "Student requests". The requests are answered on /dashboard/students/requests (M09).
//   Both:    "Your teachers" (/dashboard/teachers) in the header: a Sifu has teachers too.
// Every list has an empty state that says why it is empty and what comes next, honestly: a link
// only where there is a real next step, and never the same label twice on one screen (design-9).
// The notifications sit beside the lists (below them on a phone) with the unread count, which the
// header repeats. The data comes from the dashboard.overview and account.me procedures (the same
// ones /api/v1 serves). Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { FormMessage } from '@/components/account/fields';
import { LoadError } from '@/components/account/load-error';
import { DASHBOARD_LOAD_ERROR } from '@/components/account/load-errors/dashboard';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameLine, NameText } from '@/components/account/person-names';
import { ArrowRightIcon, PinIcon } from '@/components/icons';
import { PILOT_ACCESS_FORM, UPGRADE_CLOSED_PARAM } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { buttonVariants } from '@/components/ui/button-variants';
import { StatusBadge } from '@/components/ui/status-badge';
import { allowanceShort } from '@/lib/allowance-text';
import { cx } from '@/lib/cx';
import { formatDay, untilPlanEnd } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { DashboardOverview, PersonRef } from '@/server/services/dashboard';
import type { NextStep } from '@/server/services/next-steps';
import type { FormState } from '@/lib/form-state';
import { requestPilotAccessAction } from './actions';
import { listingForm } from './schools/form-ids';
import { ListingAction } from './schools/listing-actions';
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

/**
 * Role replay 2026-11-25 (P3-3): "Your Premium", one strip of what the paid plan adds, each a link
 * to its page (only pages that exist now, CLAUDE.md §11).
 */
function YourPremium({ links, plan }: { links: { passportHref: string; familyHref: string; cardHref: string }; plan: string }) {
  const items = [
    { href: links.passportHref, title: 'Your passport timeline', text: 'Your training year by year, on one timeline.' },
    { href: links.familyHref, title: 'Kung fu family', text: 'Your classmates and cousins, and the weekly digest of what is new.' },
    { href: links.cardHref, title: 'Your lineage card', text: 'Your line from the roots, to share, print or save as a PDF.' },
  ];
  return (
    <section aria-labelledby="your-premium-heading" className="mt-8 rounded-md border border-border-subtle bg-surface-1 p-5" data-testid="your-premium">
      <h2 id="your-premium-heading" className="font-display text-xl">
        Your {plan}
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <li key={item.href}>
            <Link href={item.href} className="group grid min-h-11 gap-1 rounded-sm p-2 -m-2 hover:bg-surface-2">
              <span className="font-semibold underline-offset-4 group-hover:underline">{item.title}</span>
              <span className="text-sm text-fg-muted">{item.text}</span>
            </Link>
          </li>
        ))}
      </ul>
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

/** The one real step for a teacher's account with a profile before anyone names them. */
const NAME_CHECK = { href: '/account', label: 'See how your name reads' };
/** A Sifu's invite link and QR code for their students (role replay 2026-11-25, P1-3). */
const INVITE_STUDENTS = { href: '/dashboard/students/invite', label: 'Invite your students' };
/** The student's next step: a request to a teacher (M09). */
const NAME_TEACHER = { href: '/dashboard/teachers/new', label: 'Name a teacher' };

function Person({ person }: { person: PersonRef }) {
  // A removed profile keeps its row, anonymous (final check, security-2): a UI text, not a name.
  if (person.removed) return <span className="font-display text-lg text-fg-muted">{person.name.value}</span>;
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
          <Empty testId="empty-requests" action={overview.hasProfile ? NAME_TEACHER : undefined}>
            {overview.hasProfile
              ? 'No open requests. Name a teacher and ask them to confirm that they taught you; the request waits here until they answer it.'
              : 'No requests yet. With a profile, you can ask your teachers to confirm that they taught you.'}
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

function SifuLists({
  overview,
  upgrade,
  confirmedSchool,
  confirmForms,
}: {
  overview: DashboardOverview;
  upgrade: ReactNode;
  /** The name of a school just confirmed with "This listing is current" from this page. */
  confirmedSchool: string | null;
  /** The outcome of each row's "This listing is current" posted without JavaScript. */
  confirmForms: Map<string, FormState | null>;
}) {
  const { requests, students, schools } = overview.sifu!;
  const allowance = allowanceShort('approved', students.approved, students.limit, overview.plan.name);
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
          <Empty testId="empty-student-requests" action={overview.hasProfile ? INVITE_STUDENTS : undefined}>
            {overview.hasProfile
              ? 'No student requests waiting. Students find you by your name in the lineage, or open your invite link, and send you a request; it appears here.'
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
            <p>
              <Link href="/dashboard/students/requests" className={buttonVariants({ variant: 'secondary' })}>
                Answer them in Student requests
                <ArrowRightIcon />
              </Link>
            </p>
          </>
        )}
      </Section>
      <Section id="schools" title="My schools">
        {confirmedSchool ? (
          <p id="outcome" role="status" tabIndex={-1} className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="home-school-confirmed">
            Confirmed: {confirmedSchool} is current as of today.
          </p>
        ) : null}
        {schools.length === 0 ? (
          <Empty testId="empty-schools">
            You have not listed a school, and no school lists you as an instructor yet. List your school, or ask its head instructor to add you; it appears here.
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
                <span className="text-sm" data-testid="home-school-status">
                  {item.statusLabel}
                </span>
                {item.openTrialRequests > 0 || item.needsConfirmation ? (
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2">
                    {item.openTrialRequests > 0 ? (
                      <Link href={`/dashboard/schools/${item.id}/inquiries`} className="link inline-flex min-h-11 items-center text-sm font-semibold" data-testid="home-school-trials">
                        {item.openTrialRequests === 1 ? '1 trial lesson request waits for an answer' : `${item.openTrialRequests} trial lesson requests wait for an answer`}
                      </Link>
                    ) : null}
                    {item.needsConfirmation ? (
                      <ListingAction schoolId={item.id} step="confirm" label="This listing is current" initial={confirmForms.get(item.id) ?? null} back="home" />
                    ) : null}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        <p className="flex flex-wrap gap-3">
          <Link href="/dashboard/schools" className={buttonVariants({ variant: 'secondary' })} data-testid="manage-schools">
            {schools.length === 0 ? 'List a school' : 'Manage your schools'}
            <ArrowRightIcon />
          </Link>
          {/* M17: the Sifu's events (seminars, camps, exam sessions). */}
          <Link href="/dashboard/events" className={buttonVariants({ variant: 'secondary' })} data-testid="manage-events">
            Your events
            <ArrowRightIcon />
          </Link>
          {/* M19: the Sifu records in their students' passports. */}
          <Link href="/dashboard/students" className={buttonVariants({ variant: 'secondary' })} data-testid="manage-student-passports">
            Your students’ passports
            <ArrowRightIcon />
          </Link>
        </p>
      </Section>
    </>
  );
}

/** Where a staff session proves the second factor, then comes back here. */
const VERIFY_FOR_DASHBOARD = '/account/security?next=%2Fdashboard';

/**
 * Staff work first (review round 1, design-8): for an administrator, the open pilot access requests.
 * Only in a session that proved the second factor (review round 2, recheck-1): before that the
 * section names no number and leads to /account/security, which comes back here.
 */
/**
 * "Next steps" (docs/adr/0039-member-navigation.md): the few things a new account still has to do,
 * in order, with the first open one as the button. Done steps show a tick and the word "Done", so
 * the state is never colour alone. The card disappears once every step is done.
 */
function NextSteps({ steps, sifu }: { steps: NextStep[]; sifu: boolean }) {
  const done = steps.filter((step) => step.done).length;
  const first = steps.find((step) => !step.done)!;
  return (
    <section aria-labelledby="next-steps-heading" data-testid="next-steps" className="grid gap-4 rounded-sm border border-border-subtle bg-surface-2 px-4 py-4 sm:px-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="next-steps-heading" className="font-display text-2xl">
          {sifu ? 'Get set up to teach' : 'Get started'}
        </h2>
        <p className="text-sm text-fg-muted">
          {done} of {steps.length} done
        </p>
      </header>
      <ol className="grid gap-3">
        {steps.map((step, index) => (
          <li key={step.key} data-testid={`next-step-${step.key}`} data-done={step.done ? 'true' : 'false'} className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className={cx(
                'mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                step.done ? 'border-verified bg-verified text-on-verified' : 'border-border-strong text-fg',
              )}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <span className="grid gap-0.5">
              <span className={cx('text-ui', step === first && 'font-semibold')}>
                {step.label}
                {step.done ? <span className="text-fg-muted"> · Done</span> : null}
              </span>
              {step.done ? null : <span className="text-sm text-fg-muted">{step.hint}</span>}
            </span>
          </li>
        ))}
      </ol>
      <Link href={first.href} className={cx(buttonVariants({ variant: 'primary', size: 'lg' }), 'justify-self-start')}>
        {first.label}
        <ArrowRightIcon />
      </Link>
    </section>
  );
}

/** For a student with a profile: where to say that they teach (the account type lives in Settings, Plan and billing). */
function TeachPrompt() {
  return (
    <p data-testid="teach-prompt" className="max-w-[56ch] text-sm text-fg-muted">
      Do you teach Wing Chun?{' '}
      <Link href="/account/plan" className="link">
        Switch to a Sifu account
      </Link>{' '}
      to accept students, list schools and publish events.
    </p>
  );
}

function StaffWork({ staff }: { staff: NonNullable<DashboardOverview['staff']> }) {
  const open = staff.openPilotRequests;
  return (
    <Section id="staff" title="Staff work">
      {!staff.secondFactorVerified ? (
        <div data-testid="staff-work" data-second-factor="unverified" className="grid justify-items-start gap-3">
          <p className="max-w-[56ch] text-ui text-fg-muted">
            Staff work opens once this session has passed the second factor. Enter the code from your authenticator app to see it.
          </p>
          <Link href={VERIFY_FOR_DASHBOARD} className={buttonVariants({ variant: 'secondary' })}>
            Verify this session
            <ArrowRightIcon />
          </Link>
        </div>
      ) : open === null ? (
        <div data-testid="staff-work" className="grid justify-items-start gap-3">
          <p className="max-w-[56ch] text-ui text-fg-muted">Historical teacher claims, profile claims and reports wait in the review queue.</p>
          <Link href="/admin/review" className={buttonVariants({ variant: 'secondary' })}>
            Review queue
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
  // A failed read shows the error state in the app shell, with "Try again" (final check, requirements-2).
  const loaded = await pageRead(Promise.all([client.dashboard.overview(), client.account.me()]));
  if (!loaded) return <LoadError {...DASHBOARD_LOAD_ERROR} retryHref="/dashboard" />;
  const [overview, me] = loaded;
  const names = me.person?.names ?? [];
  const primary = names.find((name) => name.isPrimary);
  const original = names.find((name) => !name.isPrimary && name.kind !== 'romanization');
  const offer = overview.sifu?.upgrade ?? null;
  // The outcome of "Request pilot access" posted without JavaScript. The prompt shows it; when the
  // page has no prompt any more (the account switched to Student in another tab or app, review
  // round 2, recheck-4), the message stands on its own at the same anchor.
  const pilotOutcome = await readFormResult('pilot-access', query.outcome);
  // "This listing is current" from a row of My schools comes back here (role replay 2026-11-25, P1-4).
  const ownSchools = overview.sifu?.schools ?? [];
  const confirmedSchool = typeof query.confirmed === 'string' ? (ownSchools.find((s) => s.id === query.confirmed)?.name ?? null) : null;
  const confirmForms = new Map(await Promise.all(ownSchools.filter((s) => s.needsConfirmation).map(async (s) => [s.id, await readFormResult(listingForm(s.id), query.outcome)] as const)));
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
          <p className="mt-3 flex flex-wrap gap-x-5 text-sm">
            <Link href="/plans" className="link inline-flex min-h-11 items-center">
              Compare plans
            </Link>
            <UnreadLink />
          </p>
        </header>

        {overview.premium ? <YourPremium links={overview.premium} plan={overview.plan.name} /> : null}

        <div className="mt-8 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)] lg:gap-x-14">
          <div className="grid content-start gap-10">
            {pilotOutcome && !offer ? <FormMessage form={PILOT_ACCESS_FORM} state={pilotOutcome} single /> : null}
            {overview.staff ? <StaffWork staff={overview.staff} /> : null}
            {overview.nextSteps.length > 0 ? <NextSteps steps={overview.nextSteps} sifu={sifu} /> : null}
            {!sifu && !staffOnly && overview.hasProfile ? <TeachPrompt /> : null}

            {staffOnly ? (
              <p data-testid="staff-no-profile" className="max-w-[56ch] text-ui text-fg-muted">
                Staff accounts don&apos;t need a profile;{' '}
                <Link href={ONBOARDING} className="link">
                  add one in onboarding
                </Link>{' '}
                if you also train.
              </p>
            ) : overview.organizationOnly ? (
              // Role replay 2026-11-25 (P2-6): an organization's admin is asked for no practitioner profile.
              <p data-testid="organization-no-profile" className="max-w-[56ch] text-ui text-fg-muted">
                You manage an organization, so you don&apos;t need a practitioner profile.{' '}
                <Link href="/dashboard/organization" className="link">
                  Go to your organizations
                </Link>
                , or{' '}
                <Link href={ONBOARDING} className="link">
                  add a profile in onboarding
                </Link>{' '}
                if you also train.
              </p>
            ) : overview.hasProfile ? null : overview.pendingClaimCaseId ? (
              // M10b: an invited teacher's claim waits for the reviewers; the profile comes with it.
              <div data-testid="pending-claim" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
                <p className="text-ui">Your claim of a profile is with the reviewers. When they approve it, the profile is yours.</p>
                <Link href={`/dashboard/cases/${overview.pendingClaimCaseId}`} className={cx(buttonVariants({ variant: 'secondary', size: 'lg' }))}>
                  See your claim
                </Link>
              </div>
            ) : null /* No profile yet: "Next steps" above leads to onboarding. */}

            {staffOnly || overview.organizationOnly ? null : sifu ? (
              <SifuLists
                overview={overview}
                confirmedSchool={confirmedSchool}
                confirmForms={confirmForms}
                upgrade={
                  offer ? (
                    <UpgradePrompt
                      offer={offer}
                      requestAction={requestPilotAccessAction}
                      notNowAction="/dashboard"
                      closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
                      initial={pilotOutcome}
                    />
                  ) : null
                }
              />
            ) : (
              <StudentLists overview={overview} />
            )}
          </div>
          <Notifications allHref="/dashboard/notifications" />
        </div>
      </div>
    </NotificationsProvider>
  );
}
