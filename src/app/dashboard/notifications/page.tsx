// /dashboard/notifications (milestone M18, In scope 6; docs/adr/0021-notices.md): every notice of the
// account, 20 a page, newest first, filtered by category with plain links (no JavaScript needed),
// "Mark all as read", unread ones marked in words and with a shape ("New"), and an empty state. The
// list itself is the dashboard's (../notifications.tsx); the unread count in the shell stays as it is.
// Reads the session: rendered per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { NOTIFICATIONS_LOAD_ERROR } from '@/components/account/load-errors/notifications';
import { PageRedirect } from '@/components/account/page-redirect';
import { cx } from '@/lib/cx';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { CATEGORIES, isNotificationCategory, NOTIFICATION_CATEGORIES, type NotificationCategory } from '@/server/templates/catalog';
import { Notifications, NotificationsProvider } from '../notifications';

export const instant = false;

export const metadata: Metadata = {
  title: 'Notifications',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PATH = '/dashboard/notifications';

function pageHref(category: NotificationCategory | null, page = 1): string {
  const query = new URLSearchParams();
  if (category) query.set('category', category);
  if (page > 1) query.set('page', String(page));
  const text = query.toString();
  return text ? `${PATH}?${text}` : PATH;
}

function one(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NotificationsPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PATH);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const asked = one(query.category);
  const category = isNotificationCategory(asked) ? asked : null;
  const pageAsked = Number(one(query.page) ?? '1');
  const page = Number.isInteger(pageAsked) && pageAsked >= 1 && pageAsked <= 1000 ? pageAsked : 1;
  const list = await pageRead(serverClient(await headers(), guard.principal).notifications.list({ ...(category ? { category } : {}), page }));
  if (!list) return <LoadError {...NOTIFICATIONS_LOAD_ERROR} retryHref={pageHref(category, page)} />;
  const label = category ? CATEGORIES[category].label : null;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Notifications</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Every notice of your account, newest first. Choose which of them also come by e-mail in{' '}
          <Link href="/dashboard/settings#notifications-heading" className="link">
            Account type and plan
          </Link>
          .
        </p>

        <nav aria-label="Notification categories" className="mt-6" data-testid="notification-categories">
          <ul className="flex flex-wrap gap-2">
            {[null, ...NOTIFICATION_CATEGORIES].map((c) => {
              const current = c === category;
              return (
                <li key={c ?? 'all'}>
                  <Link
                    href={pageHref(c)}
                    aria-current={current ? 'page' : undefined}
                    className={cx(
                      'inline-flex min-h-11 items-center gap-1.5 rounded-sm border px-3 text-sm',
                      // The chosen one is said with a heavier border and a mark, not by colour alone.
                      current ? 'border-2 border-fg px-[11px] font-semibold' : 'border-border-strong text-fg-muted hover:border-fg-muted hover:text-fg',
                    )}
                  >
                    {current ? <span aria-hidden="true" className="size-1.5 rounded-full bg-fg" /> : null}
                    {c ? CATEGORIES[c].label : 'All'}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="mt-6">
          <NotificationsProvider list={list}>
            <Notifications
              heading={label ? `${label} notifications` : 'All notifications'}
              back={pageHref(category, page)}
              category={category}
              empty={label ? `No ${label.toLowerCase()} notifications.` : undefined}
            />
          </NotificationsProvider>
        </div>

        {list.pages > 1 ? (
          <nav aria-label="Pages" className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-ui" data-testid="notification-pages">
            {page > 1 ? (
              <Link href={pageHref(category, page - 1)} rel="prev" className="link inline-flex min-h-11 items-center">
                Newer
              </Link>
            ) : (
              <span />
            )}
            <span className="text-sm text-fg-muted">
              Page {Math.min(page, list.pages)} of {list.pages}
            </span>
            {page < list.pages ? (
              <Link href={pageHref(category, page + 1)} rel="next" className="link inline-flex min-h-11 items-center">
                Older
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>
    </div>
  );
}
