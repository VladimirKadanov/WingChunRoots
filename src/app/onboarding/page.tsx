// /onboarding (milestone M02, In scope 5): the account's own person. A Latin-script name is
// required; the name in its original script (with its language), Jyutping, pinyin, country, city
// and the year training started are optional. The profile starts private; "Show my profile
// publicly" is never ticked in advance (plan §6.2). Data from the account.me and
// account.onboardingOptions procedures. An account that already has its profile but has not
// confirmed a new version of the documents gets only the confirmations here (In scope 4).
// "How do you take part?" sets the account type through account.setType (from plans.mine, so an
// account that is already a Sifu starts on "I teach"). Afterwards: `next`, else /dashboard.
// ADR 0056: above the form, "Is there a profile of you already?" finds a public record nobody has
// claimed (?find=) and links to its claim page; an account on its way to a claim page confirms the
// documents only, like an invited teacher.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { AuthFrame } from '@/components/account/auth-frame';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { isClaimPath } from '@/lib/invitation-path';
import { readFormResult } from '@/server/forms/flash';
import { documentsFor } from '@/server/legal/documents';
import { serverClient } from '@/server/rpc/server';
import { ConfirmConsentsForm } from './confirm-consents-form';
import { afterOnboarding, ONBOARDING_DEFAULT_NEXT, onboardingNext } from './destination';
import { FindYourself } from './find-yourself';
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
  const next = onboardingNext(query.next);
  const client = serverClient(await headers(), guard.principal);
  const me = await client.account.me();
  // The documents whose required confirmation is missing; the optional privacy tick links its own.
  const documents = documentsFor(me.missingConsents);
  // M10b: an invited teacher gets the profile made for them, so an account on its way to an
  // invitation, or whose claim waits for the reviewers, confirms the documents only.
  // ADR 0056: so does an account on its way to a claim page, while it has documents to confirm
  // (with them confirmed, sign-in goes straight to the claim page; a refused claim offers this page).
  const claiming = !me.person && (me.pendingClaim || next.startsWith('/invite/') || (isClaimPath(next) && me.missingConsents.length > 0));
  if (me.person || claiming) {
    const after = afterOnboarding(next);
    if (me.missingConsents.length === 0) return <PageRedirect to={after} title={me.person ? 'Your profile is already set up' : 'Nothing to confirm'} />;
    return (
      <AuthFrame
        eyebrow="Your account · documents"
        title={documents.length === 1 ? `Confirm the ${documents[0]!.title.toLowerCase()}` : 'Confirm the documents'}
        lede={
          me.person
            ? 'Your profile is set up. Before you continue, confirm the current version of the documents below.'
            : 'Before you claim the profile you were invited to, confirm the current version of the documents below.'
        }
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
  const find = (typeof query.find === 'string' ? query.find : '').trim().slice(0, 100);
  const [options, mine, initial, found] = await Promise.all([
    client.account.onboardingOptions(),
    client.plans.mine(),
    readFormResult('onboarding', query.outcome),
    find ? client.search.query({ q: find }).catch(() => null) : Promise.resolve(null),
  ]);
  // Only the records nobody has claimed: a claimed one is someone else's account.
  const hits = find ? (found?.people ?? []).filter((hit) => hit.invitable) : null;
  return (
    <AuthFrame
      eyebrow="Welcome · your profile"
      title="Set up your profile"
      lede="Add your name as you want it recorded. Everything except the Latin-script name is optional, and you can add more later."
      notes={NOTES}
      notesLabel="How profiles work"
    >
      <FindYourself action="/onboarding" next={next === ONBOARDING_DEFAULT_NEXT ? null : next} find={find} hits={hits} />
      <OnboardingForm
        options={options}
        accountType={mine.accountType}
        missingConsents={me.missingConsents}
        documents={documents}
        next={next}
        initial={initial}
      />
      {/* Role replay 2026-11-25 (P2-6): an account that only manages an organization needs no practitioner profile. */}
      {me.missingConsents.length === 0 ? (
        <p data-testid="organization-only" className="mt-8 border-t border-border-subtle pt-5 text-ui text-fg-muted">
          Only here to manage an organization? You don&apos;t need a practitioner profile.{' '}
          <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
            I only manage an organization
          </Link>
        </p>
      ) : null}
    </AuthFrame>
  );
}
