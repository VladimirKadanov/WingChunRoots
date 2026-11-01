// /dashboard/cases (milestone M10b): the signed-in account's own review cases: profile claims and
// instructor verifications it sent, and disputes about its relationships (cases.mine), each a link
// to its page. Historical teacher claims are followed on Your teachers (M10a). Reads the session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your cases',
  robots: { index: false },
};

const PAGE = '/dashboard/cases';

export default async function PartyCasesPage() {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const mine = await pageRead(serverClient(await headers(), guard.principal).cases.mine());
  if (!mine) return <LoadError {...REVIEW_LOAD_ERRORS.cases} retryHref={PAGE} />;
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard" className="link inline-flex min-h-11 items-center">
            Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Your cases</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          Profile claims, instructor verifications and disputes about your relationships. Claims about historical teachers are on{' '}
          <Link href="/dashboard/teachers" className="link">
            Your teachers
          </Link>
          .
        </p>
        {mine.cases.length === 0 ? (
          <p data-testid="no-cases" className="mt-8 max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui text-fg-muted">
            You have no cases.
          </p>
        ) : (
          <ul className="mt-8 grid" data-testid="party-cases">
            {mine.cases.map((c) => (
              <li key={c.id} className="grid gap-1 border-b border-border-subtle py-3">
                <Link href={`${PAGE}/${c.id}`} className="link inline-flex min-h-11 items-center font-semibold">
                  {c.kindLabel}
                </Link>
                <span className="text-sm text-fg-muted">
                  {c.statusLabel} · opened {formatDay(c.openedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
