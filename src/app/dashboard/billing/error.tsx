'use client';

// The error boundary of /dashboard/billing (M22). The page catches the failure of its own read and
// shows the same state on the server; this boundary is for anything else, inside the app shell.

import { LoadError } from '@/components/account/load-error';
import { BILLING_LOAD_ERROR } from '@/components/account/load-errors/billing';

export default function BillingError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...BILLING_LOAD_ERROR} retry={retry} />;
}
