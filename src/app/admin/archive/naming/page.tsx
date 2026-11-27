// /admin/archive/naming (review 2026-11-13, docs/adr/0088-review-1113-leftovers.md): the requests
// that name a person without an account (an unclaimed or historical record) as an organization's
// member, an event's instructor or an examination's examiner. Nobody answers for such a person, so
// the archive team decides; approved, the attachment is made; declined, nothing is. For an archivist
// or an administrator whose session passed the second factor. Reads the session.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { NamingRequestView } from '@/server/services/naming';
import { Column } from '../grid-parts';
import { archiveLoadError } from '../labels';
import { reviewNamingForm } from './form-ids';
import { ReviewNamingForm } from './review-form';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Naming requests · Archive editor'), robots: { index: false } };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

/** The kinds as t() calls, so the Bulgarian check sees them. */
function kindLabel(t: AdminT, kind: NamingRequestView['kind']): string {
  switch (kind) {
    case 'organization_member': return t('Member of an organization');
    case 'event_instructor': return t('Instructor at an event');
    case 'exam_examiner': return t('Examiner of an examination');
    case 'entry_issuer': return t('Issuer of a passport entry');
    case 'organization_admin': return t('Administrator of an organization');
  }
}

export default async function NamingRequestsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const guard = await guardRoute('/admin/archive/naming', '/admin/archive/naming');
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  const t = await getAdminT();
  if (guard.forbidden) {
    return (
      <Column>
        <div className="max-w-[46rem]">
          <p className="eyebrow">{t('Archive editor')}</p>
          <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted" data-testid="archive-denied">
            {t("You don't have access to the archive editor. It is available to archivists and administrators.")}
          </p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/admin" className="link inline-flex min-h-11 items-center">
              {t('Back to administration')}
            </Link>
          </p>
        </div>
      </Column>
    );
  }
  const data = await pageRead(serverClient(await headers(), guard.principal).naming.queue());
  if (!data) return <LoadError words={loadErrorWords(t)} {...archiveLoadError(t)} retryHref="/admin/archive/naming" />;
  const initials = await Promise.all(data.requests.map((r) => readFormResult(reviewNamingForm(r.id), query.outcome)));
  const decided = query.decided === 'approved' ? t('Approved. The record is listed now.') : query.decided === 'declined' ? t('Declined. Nothing was listed.') : null;
  return (
    <Column>
      <div className="max-w-[46rem]">
        <p className="eyebrow">{t('Archive')}</p>
        <h1 className="mt-2 font-display text-feature">{t('Naming requests')}</h1>
        <p className="mt-2 max-w-[64ch] text-sm text-fg-muted">
          {t(
            'Someone asked to list a record without an account as a member, an instructor or an examiner. Nobody can answer for that person, so the archive team decides: approve only what the archive supports.',
          )}
        </p>
      </div>
      <section id="requests" aria-labelledby="requests-heading" className="mt-8 grid scroll-mt-24 gap-4">
        <h2 id="requests-heading" className="font-display text-2xl">
          {t('Waiting for a decision')}
        </h2>
        {decided ? <OutcomeNote testId="naming-review-outcome">{decided}</OutcomeNote> : null}
        {data.requests.length === 0 ? (
          <p className="text-fg-muted" data-testid="naming-queue-empty">
            {t('Nothing waits.')}
          </p>
        ) : (
          <ul className="grid gap-5">
            {data.requests.map((r, i) => (
              <li key={r.id} className="grid gap-3 border-t border-border-subtle pt-4" data-testid="naming-queue-item" data-kind={r.kind}>
                <div className="grid gap-1">
                  <p className="font-semibold">{kindLabel(t, r.kind)}</p>
                  <p className="text-ui">
                    {r.personSlug ? (
                      <Link href={`/admin/review/records/${r.personSlug}`} className="link" translate="no">
                        {r.named}
                      </Link>
                    ) : (
                      <span translate="no">{r.named}</span>
                    )}
                    <span className="text-fg-muted"> · {r.about}</span>
                  </p>
                  <p className="text-sm text-fg-muted">
                    {t('Asked {date} by {who}', { date: formatDay(r.createdAt), who: r.askedBy ?? t('an account') })}
                  </p>
                </div>
                <ReviewNamingForm id={r.id} context={`${kindLabel(t, r.kind)}, ${r.named}`} initial={initials[i] ?? null} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </Column>
  );
}
