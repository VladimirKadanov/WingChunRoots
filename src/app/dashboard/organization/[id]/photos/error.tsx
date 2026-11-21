'use client';

// The error boundary of /dashboard/organization/<id>/photos (ADR 0052). The page catches the failure
// of its own read and shows the same state on the server; this boundary is for anything else.

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_PHOTOS_LOAD_ERROR } from '@/components/account/load-errors/organization-photos';

export default function OrganizationPhotosError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...ORGANIZATION_PHOTOS_LOAD_ERROR} retry={retry} />;
}
