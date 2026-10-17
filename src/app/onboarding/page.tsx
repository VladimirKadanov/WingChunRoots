// /onboarding (milestone M02, In scope 5): the account's own person. A Latin-script name is
// required; the name in its original script (with its language), Jyutping, pinyin, country, city
// and the year training started are optional. The profile starts private; "Show my profile
// publicly" is never ticked in advance (plan §6.2). Data from the account.me and
// account.onboardingOptions procedures.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { AuthFrame } from '@/components/account/auth-frame';
import { safeNextPath } from '@/server/auth/guards';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { OnboardingForm } from './onboarding-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Set up your profile',
  robots: { index: false },
};

const NOTES = [
  {
    title: 'An account is not a profile',
    text: 'Your account signs you in. Your profile is the record of you as a practitioner, which teachers and students link to.',
  },
  {
    title: 'Names in every script',
    text: 'The Latin-script name is shown first. The original script, Jyutping and pinyin help people find you by any spelling.',
  },
  {
    title: 'Private until you choose',
    text: 'Only the people involved in your links and the reviewers see a private profile. Nothing becomes public without your tick.',
  },
] as const;

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function OnboardingPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/onboarding');
  if (guard.forbidden) redirect('/sign-in');
  const query = await searchParams;
  const next = safeNextPath(query.next, '/account');
  const client = serverClient(await headers());
  const me = await client.account.me();
  if (me.person) redirect(next === '/onboarding' ? '/account' : next);
  const options = await client.account.onboardingOptions();
  return (
    <AuthFrame
      eyebrow="Welcome · your profile"
      title="Set up your profile"
      lede="Add your name as you want it recorded. Everything except the Latin-script name is optional, and you can add more later."
      notes={NOTES}
      notesLabel="How profiles work"
    >
      <OnboardingForm options={options} missingConsents={me.missingConsents} next={next} />
    </AuthFrame>
  );
}
