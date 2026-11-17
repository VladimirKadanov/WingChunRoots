// /account/notifications, "Notification settings" (milestone M18, In scope 3; DEFAULT M18,
// question 1): which categories of notices also come by e-mail. The dashboard always shows every
// notice; security and account are always e-mailed. Data from notifications.preferences, saved
// through notifications.setPreference. Reads the session: rendered per request.
//
// Until the usability review of 2026-11 this was the section "Notifications" of /dashboard/settings
// (#notifications-heading); it is a section of Settings now, with the settings' section row
// (SettingsNav). Its heading keeps that id, so a link to it still lands on it.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { NOTIFICATION_SETTINGS_LOAD_ERROR } from '@/components/account/load-errors/notification-settings';
import { PageRedirect } from '@/components/account/page-redirect';
import { SettingsNav } from '@/components/account/settings-nav';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { NOTIFICATIONS_FORM } from './form-ids';
import { NotificationEmailsForm } from './forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Notification settings',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function NotificationSettingsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute('/account/notifications');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  // A failed read shows the error state in the app shell, with "Try again" (as /account/plan).
  const preferences = await pageRead(serverClient(await headers(), guard.principal).notifications.preferences());
  if (!preferences) return <LoadError {...NOTIFICATION_SETTINGS_LOAD_ERROR} retryHref="/account/notifications" />;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <SettingsNav current="notifications" className="mb-8" />
      <div className="max-w-[46rem]">
        <p className="eyebrow">Settings</p>
        <h1 id="notifications-heading" className="mt-2 scroll-mt-4 font-display text-feature">
          Notification settings
        </h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Every notice appears in your{' '}
          <Link href="/dashboard/notifications" className="link">
            notifications
          </Link>
          . Choose which of them also come by e-mail. Each e-mail you can switch off has an unsubscribe link at the bottom.
        </p>
        <div className="mt-8 border-t border-border-subtle pt-6">
          <NotificationEmailsForm categories={preferences.categories} initial={await readFormResult(NOTIFICATIONS_FORM, query.outcome)} />
        </div>
      </div>
    </div>
  );
}
