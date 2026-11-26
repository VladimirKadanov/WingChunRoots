// /dashboard/places/missing (role replay 2026-11-25, P2-12; docs/adr/0071-cities-of-launch-countries.md):
// "My city is missing" under every city field leads here. The member names the city or town and
// its country; the administrators get a notification (places.reportMissing) and add the place
// with a new GeoNames extract. Back to the form the member came from (`next`).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowLeftIcon } from '@/components/icons';
import { safeNextPath } from '@/server/auth/guards';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { serverClient } from '@/server/rpc/server';
import { MISSING_PLACE_FORM, missingPlacePage } from './form-ids';
import { MissingPlaceForm } from './missing-place-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'My city is missing',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function MissingPlacePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const guard = await guardRoute('/dashboard/places/missing', missingPlacePage(next));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);
  const [options, initial] = await Promise.all([client.account.onboardingOptions(), readFormResult(MISSING_PLACE_FORM, query.outcome)]);
  // The country the form had chosen, when the link carries it (?country=).
  const country = typeof query.country === 'string' && options.countries.some((c) => c.code === query.country) ? query.country : null;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[40rem] gap-6">
        {next ? (
          <p className="eyebrow">
            <Link href={next} className="link inline-flex min-h-11 items-center gap-1.5" data-testid="missing-place-back">
              <ArrowLeftIcon size={16} />
              Back to the form
            </Link>
          </p>
        ) : null}
        <h1 className="font-display text-feature">My city is missing</h1>
        <p className="max-w-[60ch] text-fg-muted">
          The city list holds the towns of Europe and of the countries with many Wing Chun schools, from the GeoNames gazetteer. If yours is not
          there, tell the administrators its name and country: they add it, and it appears in every city list. Nothing else about you is sent.
        </p>
        <MissingPlaceForm countries={options.countries} countryCode={country} next={next} initial={initial} />
      </div>
    </div>
  );
}
