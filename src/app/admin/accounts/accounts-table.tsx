// The list of every account on /admin/accounts (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// a search form (address or name, role, state, order) and a table a page at a time, all on the
// server with their state in the URL, so it needs no JavaScript. Below a container width of 52rem
// (phones, a desktop at 200 % zoom) each row becomes a card instead of scrolling sideways; the
// explicit table roles keep the semantics when the display changes. States are words with a
// mark, never colour alone. Each row links to the actions that already exist (the profile page,
// the suspend form with the address filled in).

import Link from 'next/link';

import type { AdminT } from '@/components/admin/i18n/translate';
import { buttonVariants } from '@/components/ui/button-variants';
import type { AccountList, AccountRow } from '@/server/services/account-directory';

export interface AccountFilters {
  q?: string;
  role?: string;
  state: string;
  sort: string;
}

function roleLabel(t: AdminT, role: AccountRow['role']): string {
  switch (role) {
    case 'user': return t('Member');
    case 'moderator': return t('Moderator');
    case 'archivist': return t('Archivist');
    case 'admin': return t('Administrator');
  }
}

/** The order of the list in words, for the table's caption. */
function orderWords(t: AdminT, sort: string): string {
  if (sort === 'email') return t('Accounts, by address');
  if (sort === 'oldest') return t('Accounts, oldest first');
  if (sort === 'active') return t('Accounts, last active first');
  return t('Accounts, newest first');
}

const fieldClass =
  'block min-h-12 w-full min-w-0 rounded-sm border border-border-strong bg-surface-1 px-3 text-field text-fg hover:border-fg-muted focus-visible:border-fg';

export function accountsHref(filters: AccountFilters, page = 1): string {
  const params = new URLSearchParams();
  if (filters.q) params.set('q', filters.q);
  if (filters.role) params.set('role', filters.role);
  if (filters.state !== 'all') params.set('state', filters.state);
  if (filters.sort !== 'newest') params.set('sort', filters.sort);
  if (page > 1) params.set('page', String(page));
  const search = params.toString();
  return `/admin/accounts${search ? `?${search}` : ''}#all-accounts`;
}

function Flags({ row, t }: { row: AccountRow; t: AdminT }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {row.suspended ? (
        <span className="inline-flex items-center gap-1 font-semibold text-danger">
          <span aria-hidden="true">!</span>
          {t('Suspended')}
        </span>
      ) : (
        <span className="text-fg-muted">{t('Active')}</span>
      )}
      <span className={row.emailVerified ? 'text-fg-muted' : 'inline-flex items-center gap-1 text-review'}>
        {row.emailVerified ? (
          t('Address confirmed')
        ) : (
          <>
            <span aria-hidden="true">?</span>
            {t('Address not confirmed')}
          </>
        )}
      </span>
      {row.role !== 'user' ? <span className="text-fg-muted">{row.twoFactorEnabled ? t('Second factor on') : t('No second factor')}</span> : null}
    </span>
  );
}

export function AccountsTable({ list, filters, t }: { list: AccountList; filters: AccountFilters; t: AdminT }) {
  const first = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const last = Math.min(list.total, list.page * list.pageSize);
  return (
    <div className="grid gap-5">
      <form role="search" action="/admin/accounts#all-accounts" method="get" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-end gap-3">
        <div className="grid min-w-0 gap-1.5 sm:col-span-2">
          <label htmlFor="accounts-q" className="text-sm font-semibold">
            {t('Address or name')}
          </label>
          <input id="accounts-q" name="q" type="search" defaultValue={filters.q} maxLength={200} autoComplete="off" spellCheck={false} translate="no" className={fieldClass} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-role" className="text-sm font-semibold">
            {t('Role')}
          </label>
          <select id="accounts-role" name="role" defaultValue={filters.role ?? ''} className={fieldClass}>
            <option value="">{t('Every role')}</option>
            <option value="user">{t('Members')}</option>
            <option value="moderator">{t('Moderators')}</option>
            <option value="archivist">{t('Archivists')}</option>
            <option value="admin">{t('Administrators')}</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-state" className="text-sm font-semibold">
            {t('Show')}
          </label>
          <select id="accounts-state" name="state" defaultValue={filters.state} className={fieldClass}>
            <option value="all">{t('Every account')}</option>
            <option value="suspended">{t('Suspended only')}</option>
            <option value="unconfirmed">{t('Address not confirmed')}</option>
            <option value="staff">{t('Staff only')}</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-sort" className="text-sm font-semibold">
            {t('Order')}
          </label>
          <select id="accounts-sort" name="sort" defaultValue={filters.sort} className={fieldClass}>
            <option value="newest">{t('Newest first')}</option>
            <option value="oldest">{t('Oldest first')}</option>
            <option value="email">{t('Address, A to Z')}</option>
            <option value="active">{t('Last active first')}</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            {t('Show')}
          </button>
          {filters.q || filters.role || filters.state !== 'all' || filters.sort !== 'newest' ? (
            <Link href="/admin/accounts#all-accounts" className="link inline-flex min-h-12 items-center text-ui">
              {t('Clear')}
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-sm text-fg-muted" data-testid="accounts-count" aria-live="polite">
        {list.total === 0 ? t('No account matches.') : t('Accounts {first} to {last} of {total}', { first, last, total: list.total })}
      </p>

      {list.rows.length > 0 ? (
        <div className="@container">
          <table role="table" data-testid="accounts-table" className="w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3">
            <caption className="sr-only">{orderWords(t, filters.sort)}</caption>
            <thead role="rowgroup" className="@max-[52rem]:hidden">
              <tr role="row" className="border-b border-border-strong">
                <th role="columnheader" scope="col" className="px-2 py-2 pl-0 text-sm font-medium text-fg-muted">{t('Account')}</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium text-fg-muted">{t('Role')}</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium text-fg-muted">{t('State')}</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted">{t('Created')}</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted">{t('Last active')}</th>
                <th role="columnheader" scope="col" className="px-2 py-2 pr-0 text-sm font-medium text-fg-muted">
                  <span className="sr-only">{t('Actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="@max-[52rem]:grid @max-[52rem]:gap-3">
              {list.rows.map((row) => (
                <tr
                  role="row"
                  key={row.id}
                  data-account={row.id}
                  className="border-b border-border-subtle align-top @max-[52rem]:grid @max-[52rem]:gap-2 @max-[52rem]:rounded-md @max-[52rem]:border @max-[52rem]:bg-surface-1 @max-[52rem]:p-4"
                >
                  <td role="cell" className="py-3 pr-2 @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="block font-semibold [overflow-wrap:anywhere]" translate="no">
                      {row.email}
                    </span>
                    {row.name ? (
                      <span className="block text-sm text-fg-muted" lang={row.nameLang ?? undefined} translate="no">
                        {row.name}
                      </span>
                    ) : (
                      <span className="block text-sm text-fg-muted">{t('No profile yet')}</span>
                    )}
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    {roleLabel(t, row.role)}
                    <span className="block text-sm text-fg-muted">{row.accountType === 'sifu' ? t('Sifu') : t('Student')}</span>
                  </td>
                  <td role="cell" className="px-2 py-3 @max-[52rem]:block @max-[52rem]:p-0">
                    <Flags row={row} t={t} />
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="sr-only @max-[52rem]:not-sr-only @max-[52rem]:text-sm @max-[52rem]:text-fg-muted">{t('Created ')}</span>
                    <time dateTime={row.createdAt}>{t.shortDay(row.createdAt)}</time>
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="sr-only @max-[52rem]:not-sr-only @max-[52rem]:text-sm @max-[52rem]:text-fg-muted">{t('Last active ')}</span>
                    {row.lastActiveAt ? <time dateTime={row.lastActiveAt}>{t.shortDay(row.lastActiveAt)}</time> : <span className="text-fg-muted">{t('Never')}</span>}
                  </td>
                  <td role="cell" className="py-1.5 pl-2 @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="flex flex-wrap gap-x-4">
                      {row.personSlug ? (
                        <Link href={`/people/${row.personSlug}`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          {t('Profile')}
                          <span className="sr-only">{t(' of {email}', { email: row.email })}</span>
                        </Link>
                      ) : null}
                      {!row.suspended && row.role === 'user' ? (
                        <Link href={`/admin/accounts?email=${encodeURIComponent(row.email)}#suspend`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          {t('Suspend')}
                          <span className="sr-only"> {row.email}</span>
                        </Link>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {list.pages > 1 ? (
        <nav aria-label={t('Pages of accounts')} className="flex flex-wrap items-center gap-3 text-ui">
          {list.page > 1 ? (
            <Link href={accountsHref(filters, list.page - 1)} className={buttonVariants({ variant: 'secondary' })} rel="prev">
              {t('Previous')}
            </Link>
          ) : null}
          <span className="text-fg-muted">
            {t('Page {page} of {pages}', { page: list.page, pages: list.pages })}
          </span>
          {list.page < list.pages ? (
            <Link href={accountsHref(filters, list.page + 1)} className={buttonVariants({ variant: 'secondary' })} rel="next">
              {t('Next')}
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
