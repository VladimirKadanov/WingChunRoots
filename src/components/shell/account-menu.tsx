'use client';

// The account menu of the app shell (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// the round mark with the account's initials (and, in the side rail, its name and role) opens a
// menu of the account's own pages, the control panel for staff, and signing out. It opens on a
// click, a tap, Enter or Space, never on hover; the items are 44 px tall (MenuItem).

import Link from 'next/link';
import { useId } from 'react';

import { MenuContent, MenuItem, MenuLinkItem, MenuRoot, MenuSeparator, MenuTrigger } from '@/components/ui/menu';
import { SEARCH_RESET_EVENT, writeRecentSearches } from '@/lib/recent-searches';
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

function forgetSearches() {
  writeRecentSearches([]);
  window.dispatchEvent(new Event(SEARCH_RESET_EVENT));
}

function Initials({ initials, size }: { initials: string; size: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-fg font-semibold text-fg-inverse',
        size === 'sm' ? 'size-8 text-xs' : 'size-9 text-sm',
      )}
    >
      {initials}
    </span>
  );
}

export function AccountMenu({ variant, menu, signOut }: { variant: 'bar' | 'rail'; menu: AccountMenuView; signOut: () => Promise<void> }) {
  const formId = useId();
  const name = menu.displayName ?? 'Your account';
  const unread = menu.unreadNotifications;
  return (
    <>
      <form id={formId} action={signOut} onSubmit={forgetSearches} hidden />
      <MenuRoot>
        <MenuTrigger
          render={
            variant === 'bar' ? (
              <button
                type="button"
                data-testid="account-menu-trigger"
                aria-label={`Your account: ${name}${unread > 0 ? `, ${unread} unread` : ''}`}
                className="relative inline-flex size-11 items-center justify-center rounded-full focus-visible:-outline-offset-2"
              />
            ) : (
              <button
                type="button"
                data-testid="account-menu-trigger"
                className="flex min-h-[3.25rem] w-full min-w-0 items-center gap-3 rounded-sm px-2 text-left hover:bg-surface-3 aria-expanded:bg-surface-3"
              />
            )
          }
        >
          <Initials initials={menu.initials} size={variant === 'bar' ? 'sm' : 'md'} />
          {variant === 'rail' ? (
            <span className="grid min-w-0 flex-1">
              <span className="truncate text-ui font-semibold" lang={menu.displayName ? menu.lang : undefined} translate={menu.displayName ? 'no' : undefined}>
                {name}
              </span>
              <span className="truncate text-xs text-fg-muted">
                Signed in · {menu.roleLabel}
                {unread > 0 ? ` · ${unread} unread` : ''}
              </span>
            </span>
          ) : null}
          {variant === 'bar' && unread > 0 ? (
            // Shape and number, not colour alone: a small ink square with the count.
            <span aria-hidden="true" className="absolute top-0.5 right-0 min-w-4 rounded-[3px] border border-bg bg-fg px-0.5 text-center text-[11px] leading-4 font-semibold text-fg-inverse">
              {unread > 9 ? '9+' : unread}
            </span>
          ) : null}
        </MenuTrigger>
        <MenuContent align={variant === 'bar' ? 'end' : 'start'} side={variant === 'bar' ? 'bottom' : 'top'} className="w-72 max-w-[calc(100vw-1.5rem)]" label="Your account">
          <div className="grid gap-0.5 px-3 pt-2 pb-2.5">
            <span className="text-ui font-semibold [overflow-wrap:anywhere]" lang={menu.displayName ? menu.lang : undefined} translate={menu.displayName ? 'no' : undefined}>
              {name}
            </span>
            <span className="text-sm text-fg-muted [overflow-wrap:anywhere]" translate="no">
              {menu.email}
            </span>
            <span className="text-xs text-fg-muted">Signed in as {menu.roleLabel.toLowerCase()}</span>
          </div>
          <MenuSeparator />
          <MenuLinkItem render={<Link href="/dashboard" />}>My dashboard</MenuLinkItem>
          <MenuLinkItem render={<Link href="/dashboard/profile" />}>My profile</MenuLinkItem>
          <MenuLinkItem render={<Link href="/dashboard/notifications" />}>
            Notifications
            {unread > 0 ? <span className="ml-auto text-xs text-fg-muted">{unread} unread</span> : null}
          </MenuLinkItem>
          <MenuSeparator />
          <MenuLinkItem render={<Link href="/dashboard/billing" />}>Plan and billing</MenuLinkItem>
          <MenuLinkItem render={<Link href="/account/security" />}>Account and security</MenuLinkItem>
          <MenuLinkItem render={<Link href="/account/privacy" />}>Privacy and your data</MenuLinkItem>
          {menu.staff ? (
            <>
              <MenuSeparator />
              <MenuLinkItem render={<Link href="/admin" />} className="font-semibold" data-testid="account-menu-control-panel">
                Control panel
                <span className="ml-auto text-xs font-normal text-fg-muted">Staff</span>
              </MenuLinkItem>
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem render={<button type="submit" form={formId} className="w-full text-left" />} closeOnClick={false} data-testid="account-menu-sign-out">
            Sign out
          </MenuItem>
        </MenuContent>
      </MenuRoot>
    </>
  );
}
