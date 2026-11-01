// /dashboard/schools (milestone M11, In scope 2 and 3; plan §5.6): the schools a Sifu listed, each
// with its status (draft, waiting for review, listed) and whether its pin is on the public map:
// a listed school's pin shows while the account that listed it holds Professional Sifu (DEFAULT
// D08/D18). "List a school" opens the form. A Student account, or an account without a profile,
// is told what comes first. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowRightIcon, PlusIcon } from '@/components/icons';
import { LocationTag } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { PIN_TEXT } from './labels';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your schools',
  robots: { index: false },
};

const PAGE = '/dashboard/schools';

export default async function SchoolsDashboardPage() {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const mine = await pageRead(serverClient(await headers(), guard.principal).schools.mine());
  if (!mine) return <LoadError {...LOAD_ERRORS.schools} retryHref={PAGE} />;

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
                <li key={s.id} className="grid gap-1.5 border-b border-border-subtle py-4" data-testid="own-school" data-status={s.status} data-pin={s.pin}>
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
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
