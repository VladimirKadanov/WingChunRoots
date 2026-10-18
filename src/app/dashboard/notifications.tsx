'use client';

// The dashboard's notifications (milestone M08, In scope 6; plan §5.6): the newest ones with the
// unread count. "Mark as read" is a small, reversible personal action, so it shows at once
// (useOptimistic) while markReadAction runs, and the server's answer replaces it (refresh()).
// Without JavaScript the same form posts to the Server Action, which comes back to this list.
// Unread is said in words ("New"), not only with the dot.

import Link from 'next/link';
import { type FormEvent, startTransition, useOptimistic, useRef } from 'react';

import { NameText } from '@/components/account/person-names';
import { BellIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import type { NotificationList } from '@/server/services/notifications';
import { markReadAction } from './actions';

const ALL = '*';

export function Notifications({ list }: { list: NotificationList }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The server counts every unread notification (the list shows the newest 20): marking one read
  // takes one off that count, and "Mark all as read" brings it to zero, beyond the 20 shown too.
  const [{ items, unread }, markOptimistic] = useOptimistic({ items: list.items, unread: list.unread }, (current, id: string) => {
    const readAt = new Date().toISOString();
    if (id === ALL) return { items: current.items.map((item) => (item.readAt ? item : { ...item, readAt })), unread: 0 };
    if (!current.items.some((item) => item.id === id && !item.readAt)) return current;
    return { items: current.items.map((item) => (item.id === id ? { ...item, readAt } : item)), unread: Math.max(0, current.unread - 1) };
  });

  function submit(event: FormEvent<HTMLFormElement>, id: string) {
    // React skips the form's action when the submit event is cancelled; the transition calls it.
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    // The button goes away with the "New" state: the focus stays in the list, on its heading.
    headingRef.current?.focus();
    startTransition(async () => {
      markOptimistic(id);
      await markReadAction(form);
    });
  }

  return (
    <section id="notifications" aria-labelledby="notifications-heading" className="grid content-start gap-3 border-t border-border-subtle pt-6">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h2 id="notifications-heading" ref={headingRef} tabIndex={-1} className="flex items-center gap-3 font-display text-2xl outline-offset-4">
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
            <button type="submit" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
              Mark all as read
            </button>
          </form>
        ) : null}
      </header>

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
                <div className="flex flex-wrap items-center gap-x-4 text-sm">
                  <time dateTime={item.createdAt} className="text-fg-muted">
                    {formatDay(item.createdAt)}
                  </time>
                  {item.action ? (
                    <Link href={item.action.href} className="link inline-flex min-h-11 items-center">
                      {item.action.label}
                    </Link>
                  ) : null}
                  {isNew ? (
                    <form action={markReadAction} onSubmit={(event) => submit(event, item.id)}>
                      <input type="hidden" name="id" value={item.id} />
                      <button type="submit" className={cx(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-3')}>
                        Mark as read<span className="sr-only"> ({item.title})</span>
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
