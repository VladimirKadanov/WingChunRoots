// /dashboard/teachers/invite (milestone M10b, In scope 1; plan §6.7): "Invite your teacher to
// claim this profile". A student lists a living teacher who is not on WingChunRoots yet: an
// unclaimed record (involved_only) and a request that waits for the teacher to join
// (awaiting_claim), with an optional e-mail invitation (relationships.invite). The record and the
// request are seen only by the student, the invitee and the reviewers (DEFAULT D03), and are
// labelled "Unclaimed record" for them.
//
// With ?relationship=<id> the page sends the invitation of a request that waits, for the first
// time or again (invitations.send): a new link, the earlier one stops working.
//
// Its own route, apart from Your teachers, so the evidence field's JavaScript stays off that page
// (the bundle budget, plan §5.8). Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { INVITE_FORM, SEND_INVITATION_FORM } from './form-ids';
import { InviteForm, SendInvitationForm } from './invite-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Invite your teacher',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/teachers/invite';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/** A read that answers 404 (or a malformed address): 'missing', for the page's own state. */
async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/teachers" className="link inline-flex min-h-11 items-center">
            Your teachers
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Invite your teacher to claim this profile</h1>
        <div className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          For a living teacher who is not on WingChunRoots yet. You start their profile and your request; your teacher claims the profile from the
          invitation, a reviewer checks the claim, and then your teacher approves or declines your request themselves. A teacher who is already here
          answers on{' '}
          <Link href="/dashboard/teachers/new" className="link">
            Name a teacher
          </Link>
          .
        </div>
        <div className="mt-8 grid gap-8">{children}</div>
      </div>
    </div>
  );
}

export default async function InviteTeacherPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const relationshipId = UUID.test(one(query.relationship)) ? one(query.relationship) : null;
  const guard = await guardRoute(PAGE, relationshipId ? `${PAGE}?relationship=${relationshipId}` : PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const client = serverClient(await headers(), guard.principal);

  if (relationshipId) {
    const read = await pageRead(orMissing(client.relationships.get({ id: relationshipId })));
    if (!read) return <LoadError {...REVIEW_LOAD_ERRORS.invite} retryHref={`${PAGE}?relationship=${relationshipId}`} />;
    const view = read === 'missing' ? null : read;
    const initial = await readFormResult(SEND_INVITATION_FORM, query.outcome);
    const invitation = view?.viewerRole === 'student' ? view.invitation : null;
    return (
      <Shell>
        {view && invitation ? (
          <section aria-labelledby="send-invitation" className="grid gap-4">
            <h2 id="send-invitation" className="font-display text-2xl">
              Invitation for <NameText name={view.teacher.name} />
            </h2>
            <p className="text-sm text-fg-muted">
              <span className="font-semibold text-fg">Unclaimed record</span> · {view.lineage.name}
            </p>
            {invitation.canSend ? (
              <SendInvitationForm relationshipId={view.id} idempotencyKey={randomUUID()} again={invitation.state !== 'none'} initial={initial} />
            ) : (
              <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="invitation-claimed">
                Your teacher accepted the invitation. A reviewer checks the claim; then your teacher answers your request.
              </p>
            )}
          </section>
        ) : (
          <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="no-invitation">
            This request does not wait for its teacher to join, so it takes no invitation. See{' '}
            <Link href="/dashboard/teachers" className="link">
              Your teachers
            </Link>
            .
          </p>
        )}
      </Shell>
    );
  }

  const loaded = await pageRead(Promise.all([client.relationships.options(), client.relationships.mine(), client.account.onboardingOptions()]));
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.invite} retryHref={PAGE} />;
  const [options, mine, onboarding] = loaded;
  if (!mine.hasProfile) {
    return (
      <Shell>
        <div data-testid="needs-profile" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
          <p className="text-ui">Your profile is not set up yet. Add your name, then come back to invite your teacher.</p>
          <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Set up your profile
            <ArrowRightIcon />
          </Link>
        </div>
      </Shell>
    );
  }
  const initial = await readFormResult(INVITE_FORM, query.outcome);
  return (
    <Shell>
      <InviteForm
        options={{ lineages: options.lineages.map((l) => ({ id: l.id, name: l.name })), scripts: onboarding.scripts }}
        // A new key for every page: a refused submit keeps it (nothing was recorded), a sent one replays (plan §5.6).
        idempotencyKey={randomUUID()}
        initial={initial}
      />
    </Shell>
  );
}
