// /dashboard/photos (milestone M16; docs/adr/0019-galleries.md): the owner's gallery. Every photo
// of it counts against the plan's photo allowance (DEFAULT D07), the profile photo among them; the
// page says how many are used in words, and only at the real limit shows the upgrade prompt (plan
// §5.6, CLAUDE.md §11: only benefits of the pilot, no urgency). The data comes from gallery.mine;
// the changes go to the gallery.* procedures through /api/rpc (./gallery-manager.tsx), the ones a
// native app calls on /api/v1 (plan §6.8). Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { GalleryManager } from '@/components/gallery/gallery-manager';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { guardRoute } from '@/server/auth/web';
import { rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { GalleryView } from '@/server/services/gallery';
import { requestPilotAccessAction } from '../actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your photos',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/photos';

export default async function PhotosPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  let view: GalleryView | 'no-profile' | null;
  try {
    view = await serverClient(await headers(), guard.principal).gallery.mine();
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND') view = 'no-profile';
    else if (rpcErrorCode(error) === null || rpcErrorCode(error) === 'INTERNAL_SERVER_ERROR') view = null;
    else throw error;
  }
  if (view === null) {
    return (
      <LoadError
        eyebrow="Dashboard"
        title="Your photos"
        message="We couldn't load your photos. Nothing was changed."
        retryHref={PAGE}
        back={{ href: '/dashboard', label: 'Back to the dashboard' }}
      />
    );
  }

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[52rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your photos</h1>
        {view === 'no-profile' ? (
          <p className="mt-3 max-w-[60ch] text-ui text-fg-muted" data-testid="gallery-no-profile">
            You have no profile yet. Finish setting up your profile first, then add photos to it.
          </p>
        ) : (
          <>
            <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
              Everyone who can see your profile sees these photos. Your profile photo is one of them, and the cards in the lineage show it. Evidence you send
              for review stays private and never counts here.
            </p>
            <p className="mt-3 flex flex-wrap gap-x-4 text-ui">
              <Link href={`/people/${view.slug}`} className="link inline-flex min-h-11 items-center" data-testid="gallery-profile-link">
                See your profile
              </Link>
            </p>
            {view.upgrade ? (
              <div className="mt-6">
                <UpgradePrompt
                  offer={view.upgrade}
                  requestAction={requestPilotAccessAction}
                  notNowAction={PAGE}
                  closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
                  expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
                />
              </div>
            ) : null}
            <div className="mt-8">
              <GalleryManager view={view} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
