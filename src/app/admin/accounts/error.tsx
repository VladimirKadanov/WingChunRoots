'use client';

// The error boundary of /admin/accounts (review 2026-11; plan §5.6). The page catches the failure of
// its own read (accounts.suspended) and shows the same state on the server (works without
// JavaScript); this boundary is for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { useAdminT } from '@/components/admin/i18n/client';
import { accountsLoadError } from './load-error-text';

export default function AdminAccountsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useAdminT();
  return <LoadError {...accountsLoadError(t)} retry={retry} />;
}
