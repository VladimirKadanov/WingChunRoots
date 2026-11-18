'use client';

// The error boundary of /account/notifications (M18; plan §5.6). The page catches the failure of
// its own read and shows the same state on the server (works without JavaScript); this boundary is
// for anything else, inside the app shell, with the boundary's retry().

import { LoadError } from '@/components/account/load-error';
import { NOTIFICATION_SETTINGS_LOAD_ERROR } from '@/components/account/load-errors/notification-settings';

export default function NotificationSettingsError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <LoadError {...NOTIFICATION_SETTINGS_LOAD_ERROR} retry={retry} />;
}
