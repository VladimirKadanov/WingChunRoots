// The home page's account line (owner request 2026-11-17, docs/adr/0036-member-navigation.md): a
// visitor is asked to create an account or sign in; a signed-in member gets the way back to their
// dashboard instead of a sign-up button. The home page stays prerendered: this part reads the
// session per request and streams in behind <Suspense>, with the visitor's line as its fallback
// (the same height, so nothing moves). It shows nothing private beyond "you are signed in".

import Link from 'next/link';

import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { getRequestPrincipal } from '@/server/auth/web';

export function VisitorAccountLine() {
  return (
    <div data-testid="home-account" data-signed-in="false" className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border-subtle pt-4">
      <p className="text-sm text-fg-muted">Trained with someone? Add your link to the record.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/sign-up" className={buttonVariants({ variant: 'primary' })}>
          Create an account
        </Link>
        <Link href="/sign-in" className={buttonVariants({ variant: 'secondary' })}>
          Sign in
        </Link>
      </div>
    </div>
  );
}

export async function HomeAccountLine() {
  const principal = await getRequestPrincipal();
  if (!principal) return <VisitorAccountLine />;
  return (
    <div data-testid="home-account" data-signed-in="true" className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-border-subtle pt-4">
      <p className="text-sm text-fg-muted">You are signed in. Your teachers, requests and next steps are on your dashboard.</p>
      <div className="flex flex-wrap gap-3">
        <Link href="/dashboard" className={buttonVariants({ variant: 'primary' })}>
          Open your dashboard
          <ArrowRightIcon />
        </Link>
      </div>
    </div>
  );
}
