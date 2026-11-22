// /dashboard/organization/<id>/photos (ADR 0052): an organization's logo and banner, for its admins
// (404 for anyone else). The data comes from organizationPhotos.get; the changes go to the
// organizationPhotos.* procedures through /api/rpc (src/components/gallery/organization-photos-manager.tsx).
// Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_PHOTOS_LOAD_ERROR } from '@/components/account/load-errors/organization-photos';
import { PageRedirect } from '@/components/account/page-redirect';
import { OrganizationPhotosManager } from '@/components/gallery/organization-photos-manager';
import { guardRoute } from '@/server/auth/web';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Logo and banner',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

function NotFound() {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-photos-not-found">
      <p className="eyebrow">
        <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
          Your organizations
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">Organization not found</h1>
      <p className="mt-3 max-w-[56ch] text-fg-muted">The address may be mistyped, or you do not administer this organization.</p>
    </div>
  );
}

export default async function OrganizationPhotosPage({ params }: Props) {
  const { id } = await params;
  const page = `/dashboard/organization/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute(`${page}/photos`);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <NotFound />;
  const client = serverClient(await headers(), guard.principal);
  const notFound = (error: unknown): 'missing' => {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  };
  const [org, photos] = await Promise.all([
    pageRead(client.organizations.manage({ organizationId: id }).catch(notFound)),
    pageRead(client.organizationPhotos.get({ organizationId: id }).catch(notFound)),
  ]);
  if (org === 'missing' || photos === 'missing') return <NotFound />;
  if (!org || !photos || !photos.canChange) return <LoadError {...ORGANIZATION_PHOTOS_LOAD_ERROR} retryHref={`${page}/photos`} />;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-photos">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href={page} className="link inline-flex min-h-11 items-center" data-testid="back-to-organization">
            {org.name}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Logo and banner</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          {org.approval.status === 'active'
            ? 'Everyone sees these on the organization’s public page and its card in the list.'
            : 'Everyone will see these on the organization’s public page once the reviewers approve it.'}{' '}
          Every image is saved again without its camera details and without the place it was taken.
        </p>
        <div className="mt-8">
          <OrganizationPhotosManager view={photos} organizationName={org.name} />
        </div>
      </div>
    </div>
  );
}
