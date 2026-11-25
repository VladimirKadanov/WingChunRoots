// /join/<slug> (role replay 2026-11-25, P1-3): a Sifu's invite link for their students, shown as a
// link and a QR code in /dashboard/students/invite. It works only for a public profile that its
// person has claimed (an account answers the requests): the page names that teacher and leads to
// the request form with them chosen (/dashboard/teachers/new?teacher=<slug>). A new student goes
// through sign-up, the e-mail and onboarding and comes back to it (that path rides in the
// confirmation link, src/lib/invitation-path.ts). Nothing is recorded by opening the link; the
// student still sends the request, and the teacher still confirms it (plan §6.7).

import type { Metadata } from 'next';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { teacherRequestPath } from '@/lib/invitation-path';
import { loadProfile } from '../../people/[slug]/data';

// Reads the session-free profile per request (as /people/<slug> does): allowed to block.
export const instant = false;

export const metadata: Metadata = {
  title: 'Join your teacher on WingChunRoots',
  robots: { index: false },
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

type Params = Promise<{ slug: string }>;

export default async function JoinPage({ params }: { params: Params }) {
  const { slug: raw } = await params;
  const slug = SLUG.test(raw) && raw.length <= 120 ? raw : null;
  const read = slug ? await loadProfile(slug) : ({ state: 'none' } as const);
  const teacher = read.state === 'found' && !read.profile.limited && read.profile.visibility === 'public' && read.profile.claimState === 'claimed' && read.profile.kind === 'living' ? read.profile : null;
  const target = teacher ? teacherRequestPath(teacher.slug) : null;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[46rem] gap-6">
        <p className="eyebrow">Invite link</p>
        {teacher && target ? (
          <>
            <h1 className="font-display text-feature [overflow-wrap:anywhere]">
              Join <NameText name={{ value: teacher.displayName, lang: 'und-Latn' }} /> on WingChunRoots
            </h1>
            <div className="grid max-w-[60ch] gap-3 text-ui text-fg-muted" data-testid="join-explainer">
              <p>
                WingChunRoots records who taught whom in Wing Chun. Your teacher keeps their students here: you add your name, ask them to confirm that they teach
                you, and they answer.
              </p>
              <p>Your profile stays private until you choose to show it. Nothing about you is shared by opening this link.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href={`/sign-up?${new URLSearchParams({ next: target })}`} className={buttonVariants({ variant: 'primary', size: 'lg' })} data-testid="join-sign-up">
                Create an account
                <ArrowRightIcon />
              </Link>
              <Link href={target} prefetch={false} className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="join-continue">
                I have an account
              </Link>
            </div>
            <p className="text-sm">
              <Link href={`/people/${teacher.slug}`} className="link inline-flex min-h-11 items-center">
                See their profile
              </Link>
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-feature">This invite link does not work</h1>
            <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="join-not-found">
              The teacher&apos;s profile is not public, or the address is mistyped. Ask your teacher for the link again, or find them by name.
            </p>
            <p>
              <Link href="/dashboard/teachers/new" className={buttonVariants({ variant: 'secondary' })}>
                Find your teacher
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
