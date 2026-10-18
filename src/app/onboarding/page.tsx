// /onboarding (milestone M02, In scope 5): the account's own person. A Latin-script name is
// required; the name in its original script (with its language), Jyutping, pinyin, country, city
// and the year training started are optional. The profile starts private; "Show my profile
// publicly" is never ticked in advance (plan §6.2). Data from the account.me and
// account.onboardingOptions procedures. An account that already has its profile but has not
// confirmed a new version of the documents gets only the confirmations here (In scope 4).

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { AuthFrame } from '@/components/account/auth-frame';
import { PageRedirect } from '@/components/account/page-redirect';
import { safeNextPath } from '@/server/auth/guards';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { documentsFor } from '@/server/legal/documents';
import { serverClient } from '@/server/rpc/server';
import { ConfirmConsentsForm } from './confirm-consents-form';
import { consentsToAsk } from './missing-consents';
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
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const next = safeNextPath(query.next, '/account');
  const client = serverClient(await headers(), guard.principal);
  const me = await client.account.me();
  const documents = documentsFor(consentsToAsk(me.missingConsents));
  if (me.person) {
    const after = next === '/onboarding' ? '/account' : next;
    if (me.missingConsents.length === 0) return <PageRedirect to={after} title="Your profile is already set up" />;
    return (
      <AuthFrame
        eyebrow="Your account · documents"
        title={documents.length === 1 ? `Confirm the ${documents[0]!.title.toLowerCase()}` : 'Confirm the documents'}
        lede="Your profile is set up. Before you continue, confirm the current version of the documents below."
      >
        <ConfirmConsentsForm
          missingConsents={me.missingConsents}
          documents={documents}
          next={after}
          initial={await readFormResult('confirm-consents', query.outcome)}
        />
      </AuthFrame>
    );
  }
  const [options, initial] = await Promise.all([client.account.onboardingOptions(), readFormResult('onboarding', query.outcome)]);
  return (
    <AuthFrame
      eyebrow="Welcome · your profile"
      title="Set up your profile"
      lede="Add your name as you want it recorded. Everything except the Latin-script name is optional, and you can add more later."
      notes={NOTES}
      notesLabel="How profiles work"
    >
      <OnboardingForm options={options} missingConsents={me.missingConsents} documents={documents} next={next} initial={initial} />
    </AuthFrame>
  );
}
