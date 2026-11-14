'use client';

// The error boundary of /admin/accounts (review 2026-11; plan §5.6). The page catches the failure of
// its own read (accounts.suspended) and shows the same state on the server (works without
// JavaScript); this boundary is for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { ACCOUNTS_LOAD_ERROR } from '@/components/account/load-errors/accounts';

export default function AdminAccountsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...ACCOUNTS_LOAD_ERROR} retry={retry} />;
}
