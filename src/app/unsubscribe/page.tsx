// /unsubscribe?token=… (milestone M18, In scope 4; docs/adr/0021-notices.md): the page an e-mail's
// unsubscribe link opens. No sign-in. Opening it changes nothing (a mail system that opens links to
// scan them switches nothing off); one press of "Unsubscribe" switches the e-mails of that category
// off, and the page says in words what is off and how to switch it on again. A link whose
// preference changed since says that it no longer works. Mail clients use the one-click POST of
// List-Unsubscribe instead (./one-click/route.ts, RFC 8058).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { ArrivalFocus } from '@/components/account/arrival-focus';
import { buttonVariants } from '@/components/ui/button-variants';
import { ORPCError, serverClient } from '@/server/rpc/server';
import { unsubscribeAction } from './actions';

export const instant = false;

export const metadata: Metadata = {
  title: 'Unsubscribe',
  // The token is in the address: only the origin goes to other sites, and nothing is indexed.
  referrer: 'strict-origin',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

type Read = { state: 'ready' | 'done'; label: string } | { state: 'stale' } | { state: 'failed' };

async function read(token: string): Promise<Read> {
  if (!token) return { state: 'stale' };
  try {
    const info = await serverClient(await headers(), null).notifications.unsubscribeInfo({ token });
    return { state: info.state, label: info.label };
  } catch (error) {
    if (error instanceof ORPCError && (error.code === 'NOT_FOUND' || error.code === 'BAD_REQUEST')) return { state: 'stale' };
    return { state: 'failed' };
  }
}

export default async function UnsubscribePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token.slice(0, 200) : '';
  const result = await read(token);
  const pressFailed = query.failed === '1' && result.state === 'ready';

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <ArrivalFocus arrival={result.state === 'done' ? 'done' : null}>
        <div className="max-w-[40rem]" data-testid="unsubscribe">
          <p className="eyebrow">E-mail settings</p>
          {result.state === 'ready' ? (
            <>
              <h1 className="mt-2 font-display text-feature">Unsubscribe from {result.label} e-mails</h1>
              <p className="mt-4 text-ui text-fg-muted">
                Press the button to stop the e-mails about {result.label.toLowerCase()}. The notices still appear in your dashboard, and
                security and account e-mails keep coming.
              </p>
              {pressFailed ? (
                <p role="alert" className="mt-4 rounded-sm border-l-4 border-danger bg-surface-2 px-4 py-3 text-sm">
                  That did not work. Nothing was changed; try again.
                </p>
              ) : null}
              <form action={unsubscribeAction} className="mt-6">
                <input type="hidden" name="token" value={token} />
                <button type="submit" className={buttonVariants({ variant: 'primary' })}>
                  Unsubscribe
                </button>
              </form>
            </>
          ) : result.state === 'done' ? (
            <>
              {/* Takes the focus after the press, with JavaScript (ArrivalFocus) and without (autofocus). */}
              <h1 className="mt-2 font-display text-feature" tabIndex={-1} autoFocus data-arrival data-testid="unsubscribed">
                {result.label} e-mails are off
              </h1>
              <p className="mt-4 text-ui">
                You will not get e-mails about {result.label.toLowerCase()} any more. They still appear as notices in your dashboard, and
                security and account e-mails keep coming.
              </p>
              <p className="mt-3 text-ui text-fg-muted">
                To get them by e-mail again, sign in and tick {result.label} under Notifications in{' '}
                <Link href="/dashboard/settings#notifications-heading" className="link">
                  Account type and plan
                </Link>
                .
              </p>
            </>
          ) : result.state === 'stale' ? (
            <>
              <h1 className="mt-2 font-display text-feature">This link no longer works</h1>
              <p className="mt-4 text-ui text-fg-muted">
                Your e-mail settings changed after this e-mail was sent, or the link is not complete. Sign in and choose your e-mails under
                Notifications in{' '}
                <Link href="/dashboard/settings#notifications-heading" className="link">
                  Account type and plan
                </Link>
                .
              </p>
            </>
          ) : (
            <>
              <h1 className="mt-2 font-display text-feature">Something went wrong</h1>
              <p className="mt-4 text-ui text-fg-muted">We could not read this link just now. Nothing was changed. Try again in a moment.</p>
            </>
          )}
        </div>
      </ArrivalFocus>
    </div>
  );
}
