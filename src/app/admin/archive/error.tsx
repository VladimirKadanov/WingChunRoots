'use client';

// The error boundary of the archive editor (milestone M26; plan §5.6). The pages catch the failure of
// their own reads and show the same state on the server (works without JavaScript); this boundary is
// for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { ARCHIVE_LOAD_ERROR } from '@/components/account/load-errors/archive';

export default function ArchiveEditorError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...ARCHIVE_LOAD_ERROR} retry={retry} />;
}
