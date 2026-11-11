// /schools/[slug]/trial (M21, docs/adr/0024-trial-lessons.md): the trial lesson request form of a
// publicly listed school, for a signed-in adult. Without a session the page sends the visitor to
// sign-in and back here (?next=). When this account may not send a request now (its own school, a
// request already open there, the daily limit, an unconfirmed account or no profile) the page says
// why instead of the form. A school that is not public answers "not listed". Reads the session, so
// it renders per request and is never indexed.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { TRIAL_REQUEST_LOAD_ERROR } from '@/components/account/load-errors/trial-lessons';
import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowLeftIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { getRequestPrincipal } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TRIAL_REQUEST_FORM } from './form-ids';
import { TrialForm } from './trial-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Request a trial lesson',
  robots: { index: false, follow: false },
};

const SLUG = /^[a-z0-9-]{1,120}$/;

type Props = { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function Shell({ slug, name, children }: { slug: string; name: string | null; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href={name ? `/schools/${slug}` : '/schools'} className="link inline-flex min-h-11 items-center gap-1.5">
            <ArrowLeftIcon size={16} />
            {name ?? 'Schools'}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">Request a trial lesson</h1>
        <div className="mt-6 grid gap-6">{children}</div>
      </div>
    </div>
  );
}

export default async function TrialRequestPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const page = `/schools/${encodeURIComponent(slug)}/trial`;
  const principal = await getRequestPrincipal();
  if (!principal) return <PageRedirect to={`/sign-in?next=${encodeURIComponent(page)}`} />;
  const notListed = (
    <Shell slug={slug} name={null}>
      <p className="max-w-[56ch] text-fg-muted" data-testid="trial-not-listed">
        This school is not on the public map now, so it takes no trial lesson requests. The school finder shows every listed school.
      </p>
      <p>
        <Link href="/schools" className={buttonVariants({ variant: 'secondary' })}>
          Find a school
        </Link>
      </p>
    </Shell>
  );
  if (!SLUG.test(slug)) return notListed;
  const client = serverClient(await headers(), principal);
  const { missing, value: options } = await pageReadOne(client.trial.options({ slug }));
  if (missing) return notListed;
  if (!options) return <LoadError {...TRIAL_REQUEST_LOAD_ERROR} retryHref={page} />;
  const { school } = options;
  const outcome = await readFormResult(TRIAL_REQUEST_FORM, (await searchParams).outcome);

  if (options.state !== 'ready' || !options.sender) {
    return (
      <Shell slug={school.slug} name={school.name}>
        <p className="max-w-[56ch]" data-testid="trial-refused" data-state={options.state}>
          {options.reason}
        </p>
        <p className="flex flex-wrap gap-3">
          {options.state === 'open' || options.state === 'limit' ? (
            <Link href="/dashboard/trial-lessons" className={buttonVariants({ variant: 'secondary' })}>
              Your trial lesson requests
            </Link>
          ) : null}
          {options.state === 'no_profile' ? (
            <Link href="/onboarding" className={buttonVariants({ variant: 'secondary' })}>
              Set up your profile
            </Link>
          ) : null}
          {options.state === 'own_school' ? (
            <Link href={`/dashboard/schools/${school.id}/inquiries`} className={buttonVariants({ variant: 'secondary' })}>
              Your school&apos;s trial lesson requests
            </Link>
          ) : null}
          {options.state === 'unconfirmed' ? (
            <Link href="/account" className={buttonVariants({ variant: 'secondary' })}>
              Your account
            </Link>
          ) : null}
        </p>
      </Shell>
    );
  }

  return (
    <Shell slug={school.slug} name={school.name}>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        Ask {school.name} for a first lesson. {school.firstTrialFree ? 'The school says the first trial lesson is free. ' : ''}You can send up to{' '}
        {options.limits.perDay} requests a day, one at a time to each school.
      </p>
      <TrialForm school={school} sender={options.sender} limits={options.limits} initial={outcome} />
    </Shell>
  );
}
