// /dashboard/schools (milestone M11, In scope 2 and 3; plan §5.6): the schools a Sifu listed, each
// with its status (draft, waiting for review, listed) and whether its pin is on the public map:
// a listed school's pin shows while the account that listed it holds Professional Sifu (DEFAULT
// D08/D18). M20: a listed school awaiting confirmation (day 90) or hidden from the map by the
// activity check (day 105) says so with a mark, words and the date (DEFAULT D17); its page has the
// confirmation. "List a school" opens the form. A Student account, or an account without a profile,
// is told what comes first. M21: a school with open trial lesson requests links to its inbox.
// Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { SCHOOLS_LOAD_ERROR } from '@/components/account/load-errors/schools';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowRightIcon, PlusIcon } from '@/components/icons';
import { ActivityState } from '@/components/schools/activity-state';
import { LocationTag } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { linkForm } from '../organization/form-ids';
import { PIN_TEXT } from './labels';
import { LinkAnswer } from './organization-links';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your schools',
  robots: { index: false },
};

const PAGE = '/dashboard/schools';

const LINK_DONE: Record<string, string> = {
  accepted: 'The link is accepted. The organization’s page lists the school; the school and its pin did not change.',
  refused: 'The link is refused. Nothing changed for the school.',
  ended: 'The link ended. The school and its pin did not change.',
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function SchoolsDashboardPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  // M15: the organization links of this account's schools (organizations.schoolLinks).
  const [mine, links] = await Promise.all([pageRead(client.schools.mine()), pageRead(client.organizations.schoolLinks())]);
  if (!mine || !links) return <LoadError {...SCHOOLS_LOAD_ERROR} retryHref={PAGE} />;
  const linkRows = await Promise.all(links.links.map(async (l) => ({ ...l, initial: await readFormResult(linkForm(l.id), query.outcome) })));
  const linkDone = typeof query.organization === 'string' ? LINK_DONE[query.organization] : undefined;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your schools</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          List the school you teach at. A draft is seen only by you; a moderator reviews a listing before it is public. A public pin on the
          school map needs Professional Sifu.
        </p>

        <div className="mt-8 grid gap-6">
          {mine.accountType !== 'sifu' ? (
            <div data-testid="schools-needs-sifu" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">Schools are listed from a Sifu account. Your account is a Student account.</p>
              <Link href="/dashboard/settings" className={buttonVariants({ variant: 'secondary' })}>
                Account type and plan
                <ArrowRightIcon />
              </Link>
            </div>
          ) : !mine.hasProfile ? (
            <div data-testid="schools-needs-profile" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
              <p className="text-ui">You are the head instructor of the schools you list, so your profile comes first.</p>
              <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
                Set up your profile
                <ArrowRightIcon />
              </Link>
            </div>
          ) : (
            <p>
              <Link href={`${PAGE}/new`} className={buttonVariants({ variant: 'primary', size: 'lg' })} data-testid="new-school">
                <PlusIcon />
                List a school
              </Link>
            </p>
          )}

          {mine.schools.length === 0 ? (
            <p className="text-ui text-fg-muted" data-testid="no-schools">
              You have not listed a school yet.
            </p>
          ) : (
            <ul className="grid" data-testid="own-schools">
              {mine.schools.map((s) => (
                <li key={s.id} className="grid gap-1.5 border-b border-border-subtle py-4" data-testid="own-school" data-status={s.status} data-pin={s.pin} data-activity={s.activity.stage}>
                  <Link href={`${PAGE}/${s.id}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                    {s.name}
                  </Link>
                  <p className="text-sm text-fg-muted">
                    {s.city}, {s.countryCode} · {s.statusLabel} · last edited or confirmed {formatDay(s.lastActivityAt)}
                  </p>
                  <LocationTag precision={s.locationPrivacy === 'exact' ? 'exact' : 'city'} />
                  <p className="text-sm" data-testid="own-school-pin">
                    {PIN_TEXT[s.pin]}
                  </p>
                  {s.openTrialRequests > 0 ? (
                    <p className="text-sm">
                      <Link href={`${PAGE}/${s.id}/inquiries`} className="link inline-flex min-h-11 items-center font-semibold" data-testid="own-school-trials">
                        {s.openTrialRequests === 1 ? '1 trial lesson request waits for an answer' : `${s.openTrialRequests} trial lesson requests wait for an answer`}
                      </Link>
                    </p>
                  ) : null}
                  {s.status === 'active' && s.activity.stage !== 'current' ? (
                    <p className="text-sm font-semibold">
                      <ActivityState stage={s.activity.stage} testId="own-school-activity">
                        {s.activity.stage === 'hidden' && s.activity.hiddenAt
                          ? `Hidden from the map since ${formatDay(s.activity.hiddenAt)}: confirm the listing to show it again`
                          : `Awaiting confirmation since ${formatDay(s.activity.awaitingSince ?? s.activity.lastActivityAt)}: please confirm the listing is current`}
                      </ActivityState>
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}

          {linkRows.length > 0 || linkDone ? (
            <section id="organizations" aria-labelledby="organizations-heading" className="grid scroll-mt-3 gap-4 border-t border-border-subtle pt-6" data-testid="school-organization-links">
              <h2 id="organizations-heading" className="font-display text-2xl">
                Organizations
              </h2>
              <p className="max-w-[60ch] text-sm text-fg-muted">
                An organization asked to list your school. Accepting shows the school on the organization’s page; it changes nothing in the school, its pin or anyone’s teachers.
              </p>
              {linkDone ? (
                <p role="status" className="rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="organization-link-done">
                  {linkDone}
                </p>
              ) : null}
              <ul className="grid gap-3">
                {linkRows.map((l) => (
                  <li key={l.id} className="grid gap-2 border-b border-border-subtle pb-4" data-testid="organization-link" data-status={l.status}>
                    <p className="[overflow-wrap:anywhere]">
                      {l.organization.public ? (
                        <Link href={`/organizations/${l.organization.slug}`} className="link inline-flex min-h-11 items-center font-semibold">
                          {l.organization.name}
                        </Link>
                      ) : (
                        <span className="font-semibold">{l.organization.name}</span>
                      )}
                    </p>
                    <p className="text-sm text-fg-muted">
                      {l.organization.kindLabel}
                      {l.organization.countryCode ? `, ${l.organization.countryCode}` : ''} · {l.school.name} · {l.statusLabel}
                    </p>
                    <LinkAnswer linkId={l.id} pending={l.status === 'pending'} context={`${l.organization.name}, ${l.school.name}`} initial={l.initial} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
