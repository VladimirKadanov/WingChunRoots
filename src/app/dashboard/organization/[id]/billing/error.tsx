'use client';

// The error boundary of /dashboard/organization/<id>/billing (M23). The page catches the failure of
// its own read and shows the same state on the server; this boundary is for anything else.

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_BILLING_LOAD_ERROR } from '@/components/account/load-errors/organization-billing';

export default function OrganizationBillingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...ORGANIZATION_BILLING_LOAD_ERROR} retry={retry} />;
}
