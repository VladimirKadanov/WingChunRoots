// /admin/accounts (review 2026-11; docs/adr/0030-takedown-suspension-erasure.md): administrators
// suspend an account and lift a suspension, and erase an account for good, each with a reason, audited
// (account.suspend, account.unsuspend, account.delete). Guarded by requireStaff2FA(['admin']): an
// administrator whose session passed the second factor (others are told plainly, or sent to verify
// the session). The data and the actions go through the accounts.suspended, accounts.suspend,
// accounts.unsuspend and accounts.erase procedures (the same ones /api/v1 serves). `?case=` opens the
// erase form for the account of an open deletion request (from /admin, Account deletion requests).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import * as z from 'zod';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import { isoDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { listAccountsInput } from '@/server/services/account-directory';
import { AccountsTable } from './accounts-table';
import { ERASE_FORM } from './form-ids';
import { EraseForm, SuspendedItem, SuspendForm } from './forms';
import { accountsLoadError } from './load-error-text';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Accounts'), robots: { index: false } };
}

type Search = Promise<Record<string, string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : undefined);

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="grid content-start gap-4 border-t border-border-subtle pt-6">
      <h2 id={`${id}-heading`} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function AdminAccountsPage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const requested = one(query.case);
  const caseId = requested && UUID.test(requested) ? requested : undefined;
  const here = caseId ? `/admin/accounts?case=${caseId}` : '/admin/accounts';
  const guard = await guardRoute('/admin/accounts', here);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  const t = await getAdminT();
  if (guard.forbidden) {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <div className="max-w-[46rem]">
          <p className="eyebrow">{t('Control panel')}</p>
          <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
          <p className="mt-3 max-w-[56ch] text-fg-muted">{t("You don't have access to accounts. They are available to administrators.")}</p>
          <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
            <Link href="/account" className="link inline-flex min-h-11 items-center">
              {t('Back to your account')}
            </Link>
          </p>
        </div>
      </div>
    );
  }
  // A failed read shows the error state in the app shell, with "Try again" on the same address.
  const client = serverClient(await headers(), guard.principal);
  // Each parameter is checked against the field of accounts.list: an unknown or malformed value
  // falls back to the default instead of an error page.
  const field = listAccountsInput.unwrap().shape;
  const valid = <T,>(r: { success: true; data: T } | { success: false }) => (r.success ? r.data : undefined);
  const filters = {
    q: valid(field.q.safeParse(one(query.q)?.slice(0, 200) || undefined)),
    role: valid(field.role.safeParse(one(query.role) || undefined)),
    state: valid(field.state.safeParse(one(query.state))) ?? 'all',
    sort: valid(field.sort.safeParse(one(query.sort))) ?? 'newest',
  };
  const page = valid(field.page.safeParse(one(query.page))) ?? 1;
  const [suspended, list] = await Promise.all([pageRead(client.accounts.suspended()), pageRead(client.accounts.list({ ...filters, page }))]);
  if (!suspended || !list) return <LoadError words={loadErrorWords(t)} {...accountsLoadError(t)} retryHref={here} />;
  const prefillEmail = valid(z.string().email().max(320).safeParse(one(query.email)));
  // The account of an open deletion request, for the erase form; none when the case is not open any more.
  const overview = caseId ? await pageRead(client.admin.overview()) : null;
  const request = caseId ? (overview?.deletionRequests.find((r) => r.caseId === caseId) ?? null) : null;
  const [suspendedNow, lifted, erased] = await Promise.all([
    readFormResult('suspend-account', query.outcome),
    readFormResult('unsuspend-account', query.outcome),
    readFormResult('erase-account', query.outcome),
  ]);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <header className="max-w-[46rem]">
        <p className="eyebrow">{t('Control panel')}</p>
        <h1 className="mt-2 font-display text-feature">{t('Accounts')}</h1>
        <p className="mt-3 max-w-[60ch] text-fg-muted">
          {t(
            'Find any account, suspend an account that must be stopped now, lift a suspension, or erase an account when its person asks. Each action needs a reason and is kept in the audit log. To take a profile off the public pages, use its record page in the review queue.',
          )}
        </p>
      </header>

      <div className="mt-8 grid gap-10">
        <Section id="all-accounts" title={t('All accounts')}>
          <AccountsTable list={list} filters={filters} t={t} />
        </Section>

        <Section id="suspend" title={t('Suspend an account')}>
          <SuspendForm key={prefillEmail ?? 'new'} today={isoDay(new Date())} initial={suspendedNow} email={prefillEmail} />
        </Section>

        <Section id="suspended" title={t('Suspended accounts')}>
          {suspended.accounts.length > 0 ? (
            <ul data-testid="suspended-accounts" className="grid max-w-[46rem]">
              {suspended.accounts.map((account) => (
                <SuspendedItem
                  key={account.id}
                  account={account}
                  initial={lifted?.status === 'error' && lifted.values?.userId === account.id ? lifted : null}
                />
              ))}
            </ul>
          ) : (
            <p data-testid="no-suspended-accounts" className="max-w-[56ch] text-ui text-fg-muted">
              {t('No account is suspended.')}
            </p>
          )}
          {lifted?.status === 'done' ? <p className="max-w-[56ch] text-ui">{lifted.message}</p> : null}
        </Section>

        <Section id="erase" title={t('Erase an account')}>
          <p className="max-w-[60ch] text-ui text-fg-muted">
            {t(
              "Erasing removes what belongs to the person: the sign-in account, consents, notifications, photos, schools, events, the passport and pending requests. The profile stays as an unclaimed record, public only if it was public and a relationship others confirmed remains. The account's row stays as a nameless marker while records that others rely on refer to it. A moderator, archivist or administrator account is erased only after its role is taken away.",
            )}
          </p>
          <EraseForm key={ERASE_FORM + (caseId ?? '')} request={caseId && request ? { caseId, email: request.accountEmail } : null} initial={erased} />
        </Section>

        <p className="border-t border-border-subtle pt-5 text-ui">
          <Link href="/admin" className="link inline-flex min-h-11 items-center">
            {t('Back to administration')}
          </Link>
        </p>
      </div>
    </div>
  );
}
