'use client';

// The error boundary of /account/privacy (milestone M07; plan §5.6). The page catches the failure of
// its own read and shows the same state on the server (works without JavaScript); this boundary is
// for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';

export default function PrivacyError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...LOAD_ERRORS.privacy} retry={retry} />;
}
