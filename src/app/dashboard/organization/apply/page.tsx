// /dashboard/organization/apply (milestone M15; specification §4.3): an organization's
// application: official name, kind, leader, website, country of the headquarters, the approximate
// number of schools and an optional supporting document, stored privately as evidence (DEFAULT
// D13/D25). Sending it opens an organization_application case in the review queue; the account
// becomes the organization's first owner (an account's authority, never a membership: DEFAULT D12).

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { APPLY_FORM } from '../form-ids';
import { ApplyForm } from '../forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Apply for an organization',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/organization/apply';

export default async function ApplyOrganizationPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const [options, mine] = await Promise.all([pageRead(client.organizations.options()), pageRead(client.organizations.mine())]);
  if (!options || !mine) return <LoadError {...ORGANIZATION_LOAD_ERRORS.apply} retryHref={PAGE} />;
  const initial = await readFormResult(APPLY_FORM, query.outcome);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
            Your organizations
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Apply for an organization</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          The reviewers check that the organization exists and that you may speak for it. Approval puts its page online; it gives no plan and verifies no teacher or
          relationship. You can edit the application until they decide.
        </p>
        <div className="mt-8">
          {mine.canApply ? (
            <ApplyForm idempotencyKey={randomUUID()} initial={initial} countries={options.countries} kinds={options.kinds} />
          ) : (
            <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-apply-refusal">
              {mine.refusal}{' '}
              <Link href="/dashboard/organization" className="link">
                Your organizations
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
