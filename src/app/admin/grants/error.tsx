'use client';

// The error boundary of /admin/grants (M08 final check, requirements-2; plan §5.6). The page catches
// the failure of its own read (grants.list) and shows the same state on the server (works without
// JavaScript); this boundary is for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';

export default function AdminGrantsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...LOAD_ERRORS.grants} retry={retry} />;
}
