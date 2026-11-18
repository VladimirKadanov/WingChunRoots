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
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { PeriodLines, PersonName, RelationshipBadge } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ARBITRATE_FORM } from '../../form-ids';
import { ArbitrateForm } from '../../forms';
import { translateState } from '../../text';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Set in arbitration'), robots: { index: false } };
}

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

function Frame({ t, children }: { t: AdminT; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin/review" className="link inline-flex min-h-11 items-center">
            {t('Review queue')}
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
  const t = await getAdminT();
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Frame t={t}>
        <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="review-denied">
          {t("You don't have access to the review queue. It is available to archivists, moderators and administrators.")}
        </p>
      </Frame>
    );
  }
  const view = await pageRead(orMissing(serverClient(await headers(), guard.principal).relationships.get({ id })));
  if (view === 'missing') {
    return (
      <Frame t={t}>
        <h1 className="mt-2 font-display text-feature">{t('No such relationship')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">{t('This relationship does not exist.')}</p>
      </Frame>
    );
  }
  if (!view) return <LoadError {...REVIEW_LOAD_ERRORS.review} retryHref={path} />;
  const read = await readFormResult(ARBITRATE_FORM, query.outcome);
  const initial = read ? translateState(t, read) : read;
  const arbiter = ARBITERS.has(guard.principal!.user.role);
  const refusal = !arbiter
    ? t('A moderator or an administrator sets a relationship in arbitration.')
    : view.viewerRole !== 'reviewer'
      ? t('This relationship is yours: another moderator or an administrator handles it.')
      : view.status === 'in_arbitration'
        ? t('This relationship is already in arbitration. Its case is in the review queue.')
        : view.status !== 'verified'
          ? t('Only a verified relationship can be set in arbitration.')
          : null;

  return (
    <Frame t={t}>
      <h1 className="mt-2 font-display text-feature">{t('Set in arbitration')}</h1>
      <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
        {t(
          'Until the moderators decide, public pages show the link as “Disputed”, in words and with the arbitration seal. Both people get a notification and an e-mail with your reason and a link to send evidence. The case is assigned to you.',
        )}
      </p>
      <section aria-labelledby="arbitrate-relationship" className="mt-8 grid gap-3 border-t border-border-subtle pt-6">
        <h2 id="arbitrate-relationship" className="font-display text-2xl">
          {t('The relationship')}
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid content-start gap-1">
            <span className="text-sm text-fg-muted">{t('Teacher')}</span>
            <PersonName person={view.teacher} />
          </div>
          <div className="grid content-start gap-1">
            <span className="text-sm text-fg-muted">{t('Student')}</span>
            <PersonName person={view.student} />
          </div>
        </div>
        <p className="text-ui">
          <span className="text-fg-muted">{t('Lineage')} </span>
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
