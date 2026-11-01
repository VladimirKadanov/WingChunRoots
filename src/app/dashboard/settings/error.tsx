'use client';

// The error boundary of /dashboard/settings (M08 final check, requirements-2; plan §5.6). The page
// catches the failure of its own read and shows the same state on the server (works without
// JavaScript); this boundary is for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { SETTINGS_LOAD_ERROR } from '@/components/account/load-errors/settings';

export default function DashboardSettingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...SETTINGS_LOAD_ERROR} retry={retry} />;
}
