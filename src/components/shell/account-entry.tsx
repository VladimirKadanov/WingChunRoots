// Who is signed in, on every page (owner request 2026-11-17, docs/adr/0035-control-panel.md): a
// visitor without a session sees "Sign in" and "Create account"; a signed-in account sees its
// initials (and, in the side rail, its name) that open the account menu. It reads the session, so
// the shell renders it inside <Suspense> with AccountSlot as the fallback, which keeps the same
// room so nothing moves when it streams in (CLS). Never cached: per request, own data only.

import { headers } from 'next/headers';
import Link from 'next/link';
import { cache, type ReactNode } from 'react';

import { signOutAction } from '@/app/account/actions';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { AccountMenu } from './account-menu';

export type AccountVariant = 'bar' | 'rail';

/** The room the account entry takes, whatever it shows (the fallback is this, empty). */
export function AccountSlot({ variant, children }: { variant: AccountVariant; children?: ReactNode }) {
  return (
    <div
      data-account-slot=""
      className={cx(variant === 'bar' ? 'flex min-h-11 w-[4.75rem] shrink-0 items-center justify-end' : 'flex min-h-[6.25rem] flex-col justify-end gap-2')}
    >
      {children}
    </div>
  );
}

function SignedOut({ variant }: { variant: AccountVariant }) {
  if (variant === 'bar') {
    return (
      <Link href="/sign-in" className="inline-flex min-h-11 items-center px-1.5 text-ui font-semibold text-fg underline-offset-4 hover:underline" data-testid="shell-sign-in">
        Sign in
      </Link>
    );
  }
  return (
    <>
      <Link href="/sign-in" className={buttonVariants({ variant: 'secondary', className: 'w-full justify-center' })} data-testid="shell-sign-in">
        Sign in
      </Link>
      <Link href="/sign-up" className={buttonVariants({ variant: 'primary', className: 'w-full justify-center' })} data-testid="shell-sign-up">
        Create account
      </Link>
    </>
  );
}

/** One read per request: the phone bar and the side rail both render the entry (CSS shows one). */
const loadMenu = cache(async () => {
  const principal = await getRequestPrincipal();
  if (!principal) return null;
  return serverClient(await headers(), principal).account.menu();
});

export async function AccountEntry({ variant }: { variant: AccountVariant }) {
  const principal = await getRequestPrincipal();
  if (!principal) {
    return (
      <AccountSlot variant={variant}>
        <SignedOut variant={variant} />
      </AccountSlot>
    );
  }
  let menu;
  try {
    menu = await loadMenu();
  } catch {
    // A slow or failed read never breaks the page: the plain link to the account still works.
    return (
      <AccountSlot variant={variant}>
        <Link href="/account" className={variant === 'bar' ? 'inline-flex min-h-11 items-center px-1.5 text-ui font-semibold' : buttonVariants({ variant: 'secondary', className: 'w-full justify-center' })}>
          Account
        </Link>
      </AccountSlot>
    );
  }
  if (!menu) {
    return (
      <AccountSlot variant={variant}>
        <SignedOut variant={variant} />
      </AccountSlot>
    );
  }
  return (
    <AccountSlot variant={variant}>
      <AccountMenu
        variant={variant}
        signOut={signOutAction}
        menu={{
          displayName: menu.displayName,
          lang: menu.lang,
          initials: menu.initials,
          email: menu.email,
          roleLabel: menu.roleLabel,
          staff: menu.staff,
          unreadNotifications: menu.unreadNotifications,
        }}
      />
    </AccountSlot>
  );
}
