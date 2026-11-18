'use client';

// The error boundary of the archive editor (milestone M26; plan §5.6). The pages catch the failure of
// their own reads and show the same state on the server (works without JavaScript); this boundary is
// for anything else, inside the app shell, with the boundary's retry(). Its words are those of
// ARCHIVE_LOAD_ERROR (src/components/account/load-errors/archive.ts), in the control panel's language.

import { useAdminT } from '@/components/admin/i18n/client';
import { LoadError } from '@/components/account/load-error';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export default function ArchiveEditorError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  const t = useAdminT();
  return (
    <LoadError words={loadErrorWords(t)}
      eyebrow={t('Archive editor')}
      title={t('Archive editor')}
      message={t("We couldn't load the archive. Nothing was changed.")}
      back={{ href: '/admin', label: t('Back to administration') }}
      retry={retry}
    />
  );
}
