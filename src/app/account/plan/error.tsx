'use client';

// The error boundary of /account/plan (M08 final check, requirements-2; plan §5.6; /dashboard/settings
// until the usability review of 2026-11). The page catches the failure of its own read and shows
// the same state on the server (works without JavaScript); this boundary is for anything else,
// inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { PLAN_LOAD_ERROR } from '@/components/account/load-errors/plan';

export default function PlanSettingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...PLAN_LOAD_ERROR} retry={retry} />;
}
