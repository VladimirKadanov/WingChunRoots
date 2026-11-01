'use client';

// The error boundary of /dashboard (M08 final check, requirements-2; plan §5.6). The page catches
// the failure of its own reads and shows the same state on the server (works without JavaScript);
// this boundary is for anything else, inside the app shell, with the boundary's retry().
// /dashboard/settings has its own (./settings/error.tsx).

import { LoadError } from '@/components/account/load-error';
import { DASHBOARD_LOAD_ERROR } from '@/components/account/load-errors/dashboard';

export default function DashboardError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...DASHBOARD_LOAD_ERROR} retry={retry} />;
}
