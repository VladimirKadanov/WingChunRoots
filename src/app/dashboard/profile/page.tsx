// /dashboard/profile, "Your profile" (milestone M07, In scope 1; plan §5.3): the account edits its
// own person: names in any script, a short biography, country, city, the year training started and
// whether the profile is public. Data from profile.get; saved through the profile.update procedure
// by a thin Server Action (./actions.ts). Records kept by the archive are corrected by archivists
// (M10a). Reads the session: rendered per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import type { ProfileFormValues } from '@/lib/profile-form';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ProfileEditorLoader } from './profile-editor-loader';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your profile',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function ProfilePage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/dashboard/profile');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const view = await pageRead(serverClient(await headers(), guard.principal).profile.get());
  if (!view) return <LoadError {...LOAD_ERRORS.profile} retryHref="/dashboard/profile" />;

  if (!view.profile) {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]">
          <p className="eyebrow">Dashboard</p>
          <h1 className="mt-2 font-display text-feature">Your profile</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">You have not set up your profile yet. It takes a minute: your name, and anything else you want to add.</p>
          <p className="mt-6">
            <Link href="/onboarding?next=%2Fdashboard%2Fprofile" className={buttonVariants({ variant: 'primary', size: 'lg' })}>
              Set up your profile
            </Link>
          </p>
        </div>
      </div>
    );
  }

  const { profile, options } = view;
  const initialValues: ProfileFormValues = {
    names: profile.names.map((n) => ({
      value: n.value,
      writing: `${n.script}|${n.lang}|${n.romanization ?? ''}`,
      kind: n.kind === 'alias' ? 'alias' : 'name',
    })),
    primary: profile.names.findIndex((n) => n.isPrimary),
    bio: profile.bio?.body ?? '',
    bioLang: profile.bio?.lang ?? 'en',
    countryCode: profile.countryCode ?? '',
    placeId: profile.placeId ?? '',
    trainingStartYear: profile.trainingStartYear === null ? '' : String(profile.trainingStartYear),
    showPublicly: profile.visibility === 'public',
  };

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">Dashboard</p>
        <h1 className="mt-2 font-display text-feature">Your profile</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          How you are recorded: your names, a few words about you, and whether anyone can find your profile.
        </p>
        <div className="mt-8">
          <ProfileEditorLoader
            initialValues={initialValues}
            options={options}
            publicSlug={profile.visibility === 'public' ? profile.slug : null}
            initial={await readFormResult('profile', query.outcome)}
          />
        </div>
        <p className="mt-10 flex flex-wrap gap-x-5 border-t border-border-subtle pt-5 text-ui">
          <Link href="/account/privacy" className="link inline-flex min-h-11 items-center">
            Privacy and consents
          </Link>
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Back to your dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
