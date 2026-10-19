'use client';

// The dashboard's notifications (milestone M08, In scope 6; plan §5.6): the newest ones with the
// unread count. "Mark as read" is a small, reversible personal action, so it shows at once
// (useOptimistic) while markReadAction runs, and the server's answer replaces it (refresh()).
// Without JavaScript the same form posts to the Server Action, which comes back to this list.
// Unread is said in words ("New"), not only with the dot.
//
// Review round 1 (a11y-webview-2, -3, -5):
// - one optimistic state for the whole page (<NotificationsProvider>), so the header's "3 unread
//   notifications" link and the section's count change together;
// - a polite live region says what happened ("Marked as read. 2 unread."), and when the server
//   call fails, says so in words ("Could not mark it as read. …") while the item turns back to New;
// - after the optimistic render the focus moves to the next unread item's "Mark as read" (or to the
//   heading when none is left); after a failure it goes back to the item's button.

import Link from 'next/link';
import { createContext, type FormEvent, type ReactNode, type RefObject, startTransition, use, useEffect, useOptimistic, useRef, useState } from 'react';

import { NameText } from '@/components/account/person-names';
import { BellIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import type { NotificationList } from '@/server/services/notifications';
import { markReadAction } from './actions';

const ALL = '*';

type Items = NotificationList['items'];

interface NotificationsState {
  items: Items;
  unread: number;
  /** What the live region says: the last change, or why it failed. */
  status: { text: string; failed: boolean };
  /** Marks one notification (`id`) or all of them (ALL) read with the form's data. */
  markRead: (id: string, form: FormData) => void;
  /** Where the focus goes after the next render: an item's id, or null for the heading. */
  focusRef: RefObject<{ target: string | null } | null>;
}

const NotificationsContext = createContext<NotificationsState | null>(null);

function useNotifications(): NotificationsState {
  const value = use(NotificationsContext);
  if (!value) throw new Error('useNotifications() outside <NotificationsProvider>');
  return value;
}

const markReadId = (id: string) => `mark-read-${id === ALL ? 'all' : id}`;

/** The next unread item after `id` in the list (else the one before it), or null. */
function nextUnread(items: Items, id: string): string | null {
  const unread = items.filter((item) => !item.readAt).map((item) => item.id);
  const at = unread.indexOf(id);
  if (at === -1) return unread[0] ?? null;
  return unread[at + 1] ?? unread[at - 1] ?? null;
}

export function NotificationsProvider({ list, children }: { list: NotificationList; children: ReactNode }) {
  // The server counts every unread notification (the list shows the newest 20): marking one read
  // takes one off that count, and "Mark all as read" brings it to zero, beyond the 20 shown too.
  const [{ items, unread }, markOptimistic] = useOptimistic({ items: list.items, unread: list.unread }, (current, id: string) => {
    const readAt = new Date().toISOString();
    if (id === ALL) return { items: current.items.map((item) => (item.readAt ? item : { ...item, readAt })), unread: 0 };
    if (!current.items.some((item) => item.id === id && !item.readAt)) return current;
    return { items: current.items.map((item) => (item.id === id ? { ...item, readAt } : item)), unread: Math.max(0, current.unread - 1) };
  });
  const [status, setStatus] = useState({ text: '', failed: false });
  const focusRef = useRef<{ target: string | null } | null>(null);

  function markRead(id: string, form: FormData) {
    const left = id === ALL ? 0 : Math.max(0, unread - (items.some((item) => item.id === id && !item.readAt) ? 1 : 0));
    // The button goes away with the "New" state: the focus moves on after the optimistic render.
    focusRef.current = { target: id === ALL ? null : nextUnread(items, id) };
    startTransition(async () => {
      markOptimistic(id);
      setStatus({ text: id === ALL ? 'All marked as read.' : `Marked as read. ${left === 0 ? 'None' : left} unread.`, failed: false });
      try {
        await markReadAction(form);
      } catch {
        // useOptimistic puts the item back to New when the transition ends; say why, and give the
        // focus back to the button that failed.
        focusRef.current = { target: id };
        setStatus({ text: `Could not mark ${id === ALL ? 'them' : 'it'} as read. Check your connection and try again.`, failed: true });
      }
    });
  }

  return <NotificationsContext value={{ items, unread, status, markRead, focusRef }}>{children}</NotificationsContext>;
}

/** The header's "3 unread notifications": a native fragment link, so the focus moves with it. */
export function UnreadLink() {
  const { unread } = useNotifications();
  if (unread === 0) return null;
  return (
    <a href="#notifications" data-testid="unread-link" className="link inline-flex min-h-11 items-center">
      {unread === 1 ? '1 unread notification' : `${unread} unread notifications`}
    </a>
  );
}

export function Notifications() {
  const { items, unread, status, markRead, focusRef } = useNotifications();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const next = focusRef.current;
    if (!next) return;
    const button = next.target ? document.getElementById(markReadId(next.target)) : null;
    // The failed item's button comes back with a later render: wait for it.
    if (next.target && !button) return;
    focusRef.current = null;
    (button ?? headingRef.current)?.focus();
  }, [focusRef, items, status]);

  function submit(event: FormEvent<HTMLFormElement>, id: string) {
    // React skips the form's action when the submit event is cancelled; markRead() calls it.
    event.preventDefault();
    markRead(id, new FormData(event.currentTarget));
  }

  return (
    <section id="notifications" aria-labelledby="notifications-heading" className="grid content-start gap-3 border-t border-border-subtle pt-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2
          id="notifications-heading"
          ref={headingRef}
          tabIndex={-1}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 font-display text-2xl outline-offset-4"
        >
          Notifications
          <span data-testid="unread-count" className="inline-flex items-center gap-1.5 font-sans text-sm font-semibold">
            {unread > 0 ? (
              <>
                <span aria-hidden="true" className="size-2 rounded-full bg-fg" />
                {unread} unread
              </>
            ) : (
              <span className="text-fg-muted">none unread</span>
            )}
          </span>
        </h2>
        {unread > 0 ? (
          <form action={markReadAction} onSubmit={(event) => submit(event, ALL)}>
            <input type="hidden" name="all" value="on" />
            <button id={markReadId(ALL)} type="submit" className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </header>
      <p
        role="status"
        data-testid="notifications-status"
        className={status.failed ? 'rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-3 text-sm' : 'sr-only'}
      >
        {status.text}
      </p>

      {items.length === 0 ? (
        <p className="flex items-start gap-2 text-ui text-fg-muted">
          <BellIcon size={20} className="mt-0.5" />
          <span>No notifications yet. Answers to your requests and news about your plan appear here.</span>
        </p>
      ) : (
        <ul className="grid">
          {items.map((item) => {
            const isNew = !item.readAt;
            return (
              <li key={item.id} data-testid="notification" data-unread={isNew || undefined} className="grid gap-1.5 border-b border-border-subtle py-4 first:pt-1">
                <p className={cx('flex items-start gap-2 text-ui', isNew ? 'font-semibold' : 'text-fg-muted')}>
                  {isNew ? (
                    <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 rounded-xs border border-fg px-1.5 text-label font-semibold leading-5">
                      <span aria-hidden="true" className="size-1.5 rounded-full bg-fg" />
                      New
                    </span>
                  ) : null}
                  <span className="min-w-0">{item.title}</span>
                </p>
                <p className="max-w-[60ch] text-sm text-fg-muted">
                  {item.body.map((segment, i) => ('name' in segment ? <NameText key={i} name={segment.name} className="text-fg" /> : <span key={i}>{segment.text}</span>))}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-x-4 text-sm">
                  <span className="flex flex-wrap items-center gap-x-4">
                    {isNew ? (
                      <form action={markReadAction} onSubmit={(event) => submit(event, item.id)}>
                        <input type="hidden" name="id" value={item.id} />
                        <button id={markReadId(item.id)} type="submit" className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
                          Mark as read<span className="sr-only"> ({item.title})</span>
                        </button>
                      </form>
                    ) : null}
                    {item.action ? (
                      <Link href={item.action.href} className="link inline-flex min-h-11 items-center">
                        {item.action.label}
                      </Link>
                    ) : null}
                  </span>
                  <time dateTime={item.createdAt} className="text-fg-muted">
                    {formatDay(item.createdAt)}
                  </time>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
