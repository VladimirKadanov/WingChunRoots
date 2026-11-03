// /dashboard/schools/[id]/photos (milestone M16; docs/adr/0019-galleries.md): a school's logo and
// the photos of its rooms, for the account that listed it (the one that edits it, M11; 404 for
// anyone else). The room gallery has its own limit (DEFAULT D07: 12) apart from the account's photo
// allowance. The data comes from schoolPhotos.get; the changes go to the schoolPhotos.* procedures
// through /api/rpc (../../../../../components/gallery/school-photos-manager.tsx). Reads the
// session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { SCHOOL_LOAD_ERROR } from '@/components/account/load-errors/school';
import { PageRedirect } from '@/components/account/page-redirect';
import { SchoolPhotosManager } from '@/components/gallery/school-photos-manager';
import { guardRoute } from '@/server/auth/web';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { EditorShell, SchoolNotFound } from '../../parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Logo and photos',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }> };

export default async function SchoolPhotosPage({ params }: Props) {
  const { id } = await params;
  const page = `/dashboard/schools/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute(`${page}/photos`);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <SchoolNotFound />;
  const client = serverClient(await headers(), guard.principal);
  const notFound = (error: unknown): 'missing' => {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  };
  const [editor, photos] = await Promise.all([
    pageRead(client.schools.edit({ id }).catch(notFound)),
    pageRead(client.schoolPhotos.get({ schoolId: id }).catch(notFound)),
  ]);
  if (editor === 'missing' || photos === 'missing' || (editor && !editor.school)) return <SchoolNotFound />;
  if (!editor || !photos || !photos.canChange) return <LoadError {...SCHOOL_LOAD_ERROR} retryHref={`${page}/photos`} />;
  const school = editor.school!;
  return (
    <EditorShell title="Logo and photos" lead={`${school.name} · ${school.placeName}, ${school.countryCode}`}>
      <p>
        <Link href={page} className="link inline-flex min-h-11 items-center" data-testid="back-to-school">
          Back to the school
        </Link>
      </p>
      <p className="max-w-[60ch] text-ui text-fg-muted">
        Everyone sees these on the school’s public page while it is listed. Every photo is saved again without its camera details and without the place it
        was taken, so it never shows where a private club meets.
      </p>
      <SchoolPhotosManager view={photos} schoolName={school.name} />
    </EditorShell>
  );
}
