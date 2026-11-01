'use client';

// The error boundary of /dashboard/profile (milestone M07; plan §5.6). The page catches the failure
// of its own read and shows the same state on the server (works without JavaScript); this boundary
// is for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { PROFILE_LOAD_ERROR } from '@/components/account/load-errors/profile';

export default function ProfileError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...PROFILE_LOAD_ERROR} retry={retry} />;
}
