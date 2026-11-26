// /account/plan, "Plan and billing" (milestone M08, In scope 2; plan §6.5): the account type,
// Student or Sifu, and the plan in effect with the account's test plans; since the role replay
// 2026-11-25 (P2-13, ADR 0068) also the subscription, the paid plans and the invoices of M22, which
// had their own page, /dashboard/billing (it redirects here now; ./_billing/sections.tsx). Changing the type sets the
// free plan of that type, is audited, and verifies nothing (DEFAULT D04): a Sifu without an approved instructor
// verification shows as "Instructor (unverified)" (DEFAULT D04/D13). From Sifu to Student every
// confirmed link stays confirmed (DEFAULT D06/D08). Reads the session: rendered per request.
//
// Until the usability review of 2026-11 this was /dashboard/settings, "Account type and plan", which
// also held the e-mail settings of the notices (M18). Both are sections of Settings now, with the
// settings' section row (SettingsNav): the e-mail settings are /account/notifications, and
// /dashboard/settings redirects here for good (next.config.ts). An old link to its
// #notifications-heading lands on the pointer to them at the end of this page.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { PLAN_LOAD_ERROR } from '@/components/account/load-errors/plan';
import { PageRedirect } from '@/components/account/page-redirect';
import { SettingsNav } from '@/components/account/settings-nav';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDay, untilPlanEnd } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { FREE_SIFU_STUDENT_LIMIT } from '@/server/entitlements/plans';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { BillingSections } from './_billing/sections';
import { AccountTypeForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Plan and billing',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle pt-6">
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default async function PlanSettingsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/account/plan');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden || !guard.principal) return <PageRedirect to="/sign-in" />;
  const principal = guard.principal;
  const query = await searchParams;
  // A failed read shows the error state in the app shell, with "Try again" (final check, requirements-2).
  const requestHeaders = await headers();
  const client = serverClient(requestHeaders, guard.principal);
  const mine = await pageRead(client.plans.mine());
  if (!mine) return <LoadError {...PLAN_LOAD_ERROR} retryHref="/account/plan" />;
  const badge = mine.instructor.status === 'verified' ? 'verified' : mine.instructor.status === 'unverified' ? 'unconfirmed' : null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <SettingsNav current="plan" className="mb-8" />
      <div className="max-w-[46rem]">
        <p className="eyebrow">Settings</p>
        <h1 className="mt-2 font-display text-feature">Plan and billing</h1>

        <div className="mt-8 grid gap-10">
          <Section id="account-type-heading" title="Account type">
            <div className="grid gap-5">
              <p className="max-w-[60ch] text-ui text-fg-muted">
                The type sets your free plan. Choosing Sifu doesn&apos;t verify you as an instructor — an archivist does that separately.
                Your confirmed links never change, whichever you choose; a Student account approves no new students. You can change the
                type up to five times in 24 hours.
              </p>
              <AccountTypeForm
                current={mine.accountType}
                // DEFAULT D06: the Free Sifu limit, from the plan matrix (final check, code-3).
                studentLimit={FREE_SIFU_STUDENT_LIMIT}
                instructorVerified={mine.verifiedInstructor}
                initial={await readFormResult('account-type', query.outcome)}
              />
            </div>
          </Section>

          <Section id="plan-heading" title="Your plan">
            <dl className="grid grid-cols-[minmax(0,1fr)] sm:grid-cols-[10rem_minmax(0,1fr)]">
              <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">Shown as</dt>
              <dd className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3">
                {/* The label alone (the M08 test reads it); the M10b link sits beside it. */}
                <span data-testid="instructor-label">{badge ? <StatusBadge state={badge} label={mine.instructor.label} /> : mine.instructor.label}</span>
                {/* M10b: where an unverified Sifu sends instructor evidence (DEFAULT D04/D13). */}
                {mine.instructor.status === 'unverified' ? (
                  <>
                    {' '}
                    <Link href="/dashboard/instructor" className="link inline-flex min-h-11 items-center">
                      Send instructor evidence
                    </Link>
                  </>
                ) : null}
              </dd>
              <dt className="pt-3 text-sm text-fg-muted sm:border-t sm:border-border-subtle sm:pb-3">Plan in effect</dt>
              <dd data-testid="settings-plan" className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:border-b-0 sm:pt-3">
                <span className="font-semibold">{mine.plan.name}</span>
                {mine.until ? <span className="text-fg-muted"> {untilPlanEnd(mine.until)}</span> : null}
              </dd>
              {/* M22: a paid plan in test mode is not a test plan: it is the subscription, managed below. */}
              <dt className="pt-3 text-sm text-fg-muted sm:border-y sm:border-border-subtle sm:pb-3">Test plans</dt>
              <dd className="border-b border-border-subtle pb-3 text-ui sm:border-t sm:pt-3">
                {mine.grants.filter((grant) => !grant.paid).length === 0 ? (
                  <span className="text-fg-muted">None. An administrator can give a test plan; nothing is charged.</span>
                ) : (
                  <ul className="grid gap-1.5">
                    {mine.grants.filter((grant) => !grant.paid).map((grant) => (
                      <li key={grant.id}>
                        <span className="font-semibold">{grant.planName}</span>
                        <span className="text-fg-muted">
                          {grant.state === 'scheduled' ? ` from ${formatDay(grant.startsAt)}` : ` since ${formatDay(grant.startsAt)}`}
                          {grant.endsAt ? ` ${untilPlanEnd(grant.endsAt)}` : ', no end date'}
                          {grant.state === 'active' && !grant.inEffect ? '. It counts while the account type matches the plan.' : '.'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </dl>
            <p data-testid="plan-day-hint" className="mt-4 max-w-[60ch] text-sm text-fg-muted">
              A plan starts and stops at 00:00 UTC, so &ldquo;until&rdquo; names its last full day.
            </p>
            {mine.pilotRequest ? (
              <p className="mt-4 text-sm text-fg-muted">
                You asked for pilot access to {mine.pilotRequest.planName} on {formatDay(mine.pilotRequest.createdAt)}. An administrator
                either gives you the plan or closes the request, and you get a notification either way. Nothing is charged.
              </p>
            ) : null}
            <p className="mt-5 flex flex-wrap gap-x-5 text-ui">
              <Link href="/plans" className="link inline-flex min-h-11 items-center">
                Compare plans
              </Link>
            </p>
          </Section>

          {/* Role replay 2026-11-25, P2-13 (ADR 0068): the subscription, the paid plans and the
              invoices are part of this page; /dashboard/billing redirects here. */}
          <BillingSections principal={principal} requestHeaders={requestHeaders} query={query} />

          {/* The e-mail settings of the notices were a section here until the usability review of
              2026-11: an old /dashboard/settings#notifications-heading link (an e-mail, a bookmark)
              arrives through the redirect at this id and finds where they are now. */}
          <p id="notifications-heading" className="scroll-mt-4 border-t border-border-subtle pt-6 text-ui text-fg-muted">
            Looking for which notices come by e-mail? They are in{' '}
            <Link href="/account/notifications" className="link text-fg">
              Notification settings
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
