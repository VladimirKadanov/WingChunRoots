// /admin/review/arbitrate/<relationship id> (milestone M10b, In scope 5; plan §6.7, DEFAULT D19):
// a moderator or an administrator sets a verified relationship in arbitration with a reason. The
// relationship comes from relationships.get (a reviewer reads any relationship); the form is a thin
// Server Action over review.arbitrate, which checks the role, the second factor and the status
// again. Success opens the dispute's case card. A non-staff account sees the explicit denied state.
// Reached from the archival record page (/admin/review/records/<slug>). Reads the session.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ARBITRATE_FORM } from '../../form-ids';
import { ArbitrateForm } from '../../forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Set in arbitration',
  robots: { index: false },
};

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The roles that set arbitration (review-core.ts DECIDERS.relationship_dispute). */
const ARBITERS = new Set(['moderator', 'admin']);

async function orMissing<T>(read: Promise<T>): Promise<T | 'missing'> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing';
    throw error;
  }
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin/review" className="link inline-flex min-h-11 items-center">
            Review queue
          </Link>
        </p>
        {children}
      </div>
    </div>
  );
}

export default async function ArbitratePage({ params, searchParams }: { params: Params; searchParams: Search }) {
  const { id } = await params;
  const query = await searchParams;
  const path = UUID.test(id) ? `/admin/review/arbitrate/${id}` : '/admin/review';
  const guard = await guardRoute('/admin/review', path);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">Not available</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="review-denied">
          You don&apos;t have access to the review queue. It is available to archivists, moderators and administrators.
        </p>
      </Frame>
    );
  }
  const view = await pageRead(orMissing(serverClient(await headers(), guard.principal).relationships.get({ id })));
  if (view === 'missing') {
    return (
      <Frame>
        <h1 className="mt-2 font-display text-feature">No such relationship</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">This relationship does not exist.</p>
      </Frame>
    );
  }
  if (!view) return <LoadError {...REVIEW_LOAD_ERRORS.review} retryHref={path} />;
  const initial = await readFormResult(ARBITRATE_FORM, query.outcome);
  const arbiter = ARBITERS.has(guard.principal!.user.role);
  const refusal = !arbiter
    ? 'A moderator or an administrator sets a relationship in arbitration.'
    : view.viewerRole !== 'reviewer'
      ? 'This relationship is yours: another moderator or an administrator handles it.'
      : view.status === 'in_arbitration'
        ? 'This relationship is already in arbitration. Its case is in the review queue.'
        : view.status !== 'verified'
          ? 'Only a verified relationship can be set in arbitration.'
          : null;

  return (
    <Frame>
      <h1 className="mt-2 font-display text-feature">Set in arbitration</h1>
      <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
        Until the moderators decide, public pages show the link as “Disputed”, in words and with the arbitration seal. Both people get a notification
        and an e-mail with your reason and a link to send evidence. The case is assigned to you.
      </p>
      <section aria-labelledby="arbitrate-relationship" className="mt-8 grid gap-3 border-t border-border-subtle pt-6">
        <h2 id="arbitrate-relationship" className="font-display text-2xl">
          The relationship
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-1">
            <span className="text-sm text-fg-muted">Teacher</span>
            <PersonName person={view.teacher} />
          </div>
          <div className="grid content-start gap-1">
            <span className="text-sm text-fg-muted">Student</span>
            <PersonName person={view.student} />
          </div>
        </div>
        <p className="text-ui">
          <span className="text-fg-muted">Lineage </span>
          {view.lineage.name}
        </p>
        <div className="text-ui">
          <PeriodLines periods={view.periods} />
        </div>
        <div>
          <RelationshipBadge view={view} />
        </div>
      </section>
      <div className="mt-8 max-w-[40rem]">
        {refusal ? (
          <p className="rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="arbitrate-refusal">
            {refusal}
          </p>
        ) : (
          <ArbitrateForm relationshipId={view.id} idempotencyKey={randomUUID()} initial={initial} />
        )}
      </div>
    </Frame>
  );
}
