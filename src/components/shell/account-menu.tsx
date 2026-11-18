// The account menu of the app shell (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// the round mark with the account's initials (and, in the side rail, its name and role) opens a
// list of the account's own pages, the control panel for staff, and signing out.
//
// Rendered on the server with the browser's Popover API, so it adds no script to any page (plan
// §5.8 (c), where most routes sit at their budget): the button opens the list (popovertarget; the
// browser exposes it as expanded or collapsed), Escape or a click outside closes it and focus
// returns to the button, all natively. Its links are plain links (a full page load closes the
// list), and /sign-in?signed-out=1 forgets the recent searches after signing out. These
// are navigation links, so it is a disclosure, not an ARIA menu. It opens on a click, a tap, Enter
// or Space, never on hover; every row is at least 44 px tall. Placed with CSS anchor positioning,
// with fixed corners where the browser has none.

import type { CSSProperties, ReactNode } from 'react';

import { cx } from '@/lib/cx';

/** What the shell's server part hands over (account.menu): the account's own data only. */
export interface AccountMenuView {
  displayName: string | null;
  lang: string;
  initials: string;
  email: string;
  roleLabel: string;
  staff: boolean;
  unreadNotifications: number;
}

const rowClass = 'flex min-h-11 w-full items-center gap-3 rounded-sm px-3 text-left text-sm text-fg hover:bg-surface-3 focus-visible:-outline-offset-2';

function Row({ href, children, testId, strong }: { href: string; children: ReactNode; testId?: string; strong?: boolean }) {
  return (
    <li>
      <a href={href} className={cx(rowClass, strong && 'font-semibold')} data-testid={testId}>
        {children}
      </a>
    </li>
  );
}

function Separator() {
  return <li aria-hidden="true" className="mx-2 my-1 h-px bg-border-subtle" />;
}

function Initials({ initials, size }: { initials: string; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cx('inline-flex shrink-0 items-center justify-center rounded-full bg-fg font-semibold text-fg-inverse', size === 'sm' ? 'size-8 text-xs' : 'size-9 text-sm')}
    >
      {initials}
    </span>
  );
}

export function AccountMenu({ variant, menu, signOut }: { variant: 'bar' | 'rail'; menu: AccountMenuView; signOut: () => Promise<void> }) {
  const id = `account-menu-${variant}`;
  const anchor = `--account-${variant}`;
  const name = menu.displayName ?? 'Your account';
  const unread = menu.unreadNotifications;
  const named = menu.displayName ? { lang: menu.lang, translate: 'no' as const } : {};
  return (
    <>
      <button
        type="button"
        popoverTarget={id}
        data-testid="account-menu-trigger"
        style={{ anchorName: anchor } as CSSProperties}
        className={
          variant === 'bar'
            ? 'relative inline-flex size-[44px] shrink-0 items-center justify-center rounded-full focus-visible:-outline-offset-2'
            : 'flex min-h-[3.25rem] w-full min-w-0 items-center gap-3 rounded-sm px-2 text-left hover:bg-surface-3'
        }
      >
        <Initials initials={menu.initials} size={variant === 'bar' ? 'sm' : 'md'} />
        {variant === 'bar' ? (
          // The name in words for assistive technology; the initials are a picture of it.
          <span className="sr-only">
            Your account: {name}
            {unread > 0 ? `, ${unread} unread` : ''}
          </span>
        ) : null}
        {variant === 'rail' ? (
          <span className="grid min-w-0 flex-1">
            <span className="truncate text-ui font-semibold" {...named}>
              {name}
            </span>
            <span className="truncate text-xs text-fg-muted">
              Signed in · {menu.roleLabel}
              {unread > 0 ? ` · ${unread} unread` : ''}
            </span>
          </span>
        ) : unread > 0 ? (
          // Shape and number, not colour alone: a small ink square with the count.
          <span aria-hidden="true" className="absolute top-0.5 right-0 min-w-4 rounded-[3px] border border-bg bg-fg px-0.5 text-center text-caption leading-4 font-semibold tracking-normal text-fg-inverse">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      <div
        id={id}
        popover="auto"
        data-testid="account-menu"
        data-variant={variant}
        style={{ positionAnchor: anchor } as CSSProperties}
        className="account-popover w-72 max-w-[calc(100vw-1.5rem)] rounded-md border border-border-subtle bg-surface-2 p-1 text-fg shadow-pop"
      >
        <div className="grid gap-0.5 px-3 pt-2 pb-2.5">
          <span className="text-ui font-semibold [overflow-wrap:anywhere]" {...named}>
            {name}
          </span>
          <span className="text-sm text-fg-muted [overflow-wrap:anywhere]" translate="no">
            {menu.email}
          </span>
          <span className="text-xs text-fg-muted">Signed in as {menu.roleLabel.toLowerCase()}</span>
        </div>
        <ul aria-label="Your account">
          <Separator />
          <Row href="/dashboard">My dashboard</Row>
          <Row href="/dashboard/profile">My profile</Row>
          <Row href="/dashboard/notifications">
            Notifications
            {unread > 0 ? <span className="ml-auto text-xs text-fg-muted">{unread} unread</span> : null}
          </Row>
          <Separator />
          <Row href="/account/plan">Plan and billing</Row>
          <Row href="/account/security">Account and security</Row>
          <Row href="/account/privacy">Privacy and your data</Row>
          {menu.staff ? (
            <>
              <Separator />
              <Row href="/admin" testId="account-menu-control-panel" strong>
                Control panel
                <span className="ml-auto text-xs font-normal text-fg-muted">Staff</span>
              </Row>
            </>
          ) : null}
          <Separator />
          <li>
            <form action={signOut} data-sign-out="">
              <button type="submit" className={rowClass} data-testid="account-menu-sign-out">
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </div>
    </>
  );
}
