// The list of every account on /admin/accounts (owner request 2026-11-17, docs/adr/0035-control-panel.md):
// a search form (address or name, role, state, order) and a table a page at a time, all on the
// server with their state in the URL, so it needs no JavaScript. Below a container width of 52rem
// (phones, a desktop at 200 % zoom) each row becomes a card instead of scrolling sideways; the
// explicit table roles keep the semantics when the display changes. States are words with a
// mark, never colour alone. Each row links to the actions that already exist (the profile page,
// the suspend form with the address filled in).

import Link from 'next/link';

import { buttonVariants } from '@/components/ui/button-variants';
import { formatShortDay } from '@/lib/dates';
import type { AccountList, AccountRow } from '@/server/services/account-directory';

export interface AccountFilters {
  q?: string;
  role?: string;
  state: string;
  sort: string;
}

const ROLE_LABELS: Record<AccountRow['role'], string> = { user: 'Member', moderator: 'Moderator', archivist: 'Archivist', admin: 'Administrator' };

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

function Flags({ row }: { row: AccountRow }) {
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
      {row.suspended ? (
        <span className="inline-flex items-center gap-1 font-semibold text-danger">
          <span aria-hidden="true">!</span>Suspended
        </span>
      ) : (
        <span className="text-fg-muted">Active</span>
      )}
      <span className={row.emailVerified ? 'text-fg-muted' : 'inline-flex items-center gap-1 text-review'}>
        {row.emailVerified ? 'Address confirmed' : <><span aria-hidden="true">?</span>Address not confirmed</>}
      </span>
      {row.role !== 'user' ? <span className="text-fg-muted">{row.twoFactorEnabled ? 'Second factor on' : 'No second factor'}</span> : null}
    </span>
  );
}

export function AccountsTable({ list, filters }: { list: AccountList; filters: AccountFilters }) {
  const first = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const last = Math.min(list.total, list.page * list.pageSize);
  return (
    <div className="grid gap-5">
      <form role="search" action="/admin/accounts#all-accounts" method="get" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] items-end gap-3">
        <div className="grid min-w-0 gap-1.5 sm:col-span-2">
          <label htmlFor="accounts-q" className="text-sm font-semibold">
            Address or name
          </label>
          <input id="accounts-q" name="q" type="search" defaultValue={filters.q} maxLength={200} autoComplete="off" spellCheck={false} translate="no" className={fieldClass} />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-role" className="text-sm font-semibold">
            Role
          </label>
          <select id="accounts-role" name="role" defaultValue={filters.role ?? ''} className={fieldClass}>
            <option value="">Every role</option>
            <option value="user">Members</option>
            <option value="moderator">Moderators</option>
            <option value="archivist">Archivists</option>
            <option value="admin">Administrators</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-state" className="text-sm font-semibold">
            Show
          </label>
          <select id="accounts-state" name="state" defaultValue={filters.state} className={fieldClass}>
            <option value="all">Every account</option>
            <option value="suspended">Suspended only</option>
            <option value="unconfirmed">Address not confirmed</option>
            <option value="staff">Staff only</option>
          </select>
        </div>
        <div className="grid min-w-0 gap-1.5">
          <label htmlFor="accounts-sort" className="text-sm font-semibold">
            Order
          </label>
          <select id="accounts-sort" name="sort" defaultValue={filters.sort} className={fieldClass}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="email">Address, A to Z</option>
            <option value="active">Last active first</option>
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonVariants({ variant: 'secondary', size: 'lg' })}>
            Show
          </button>
          {filters.q || filters.role || filters.state !== 'all' || filters.sort !== 'newest' ? (
            <Link href="/admin/accounts#all-accounts" className="link inline-flex min-h-12 items-center text-ui">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-sm text-fg-muted" data-testid="accounts-count" aria-live="polite">
        {list.total === 0 ? 'No account matches.' : `Accounts ${first} to ${last} of ${list.total}`}
      </p>

      {list.rows.length > 0 ? (
        <div className="@container">
          <table role="table" data-testid="accounts-table" className="w-full border-collapse text-left text-ui @max-[52rem]:grid @max-[52rem]:gap-3">
            <caption className="sr-only">Accounts, {filters.sort === 'email' ? 'by address' : filters.sort === 'oldest' ? 'oldest first' : filters.sort === 'active' ? 'last active first' : 'newest first'}</caption>
            <thead role="rowgroup" className="@max-[52rem]:hidden">
              <tr role="row" className="border-b border-border-strong">
                <th role="columnheader" scope="col" className="px-2 py-2 pl-0 text-sm font-medium text-fg-muted">Account</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium text-fg-muted">Role</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium text-fg-muted">State</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted">Created</th>
                <th role="columnheader" scope="col" className="px-2 py-2 text-sm font-medium whitespace-nowrap text-fg-muted">Last active</th>
                <th role="columnheader" scope="col" className="px-2 py-2 pr-0 text-sm font-medium text-fg-muted">
                  <span className="sr-only">Actions</span>
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
                      <span className="block text-sm text-fg-muted">No profile yet</span>
                    )}
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    {ROLE_LABELS[row.role]}
                    <span className="block text-sm text-fg-muted">{row.accountType === 'sifu' ? 'Sifu' : 'Student'}</span>
                  </td>
                  <td role="cell" className="px-2 py-3 @max-[52rem]:block @max-[52rem]:p-0">
                    <Flags row={row} />
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="sr-only @max-[52rem]:not-sr-only @max-[52rem]:text-sm @max-[52rem]:text-fg-muted">Created </span>
                    <time dateTime={row.createdAt}>{formatShortDay(row.createdAt)}</time>
                  </td>
                  <td role="cell" className="px-2 py-3 whitespace-nowrap @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="sr-only @max-[52rem]:not-sr-only @max-[52rem]:text-sm @max-[52rem]:text-fg-muted">Last active </span>
                    {row.lastActiveAt ? <time dateTime={row.lastActiveAt}>{formatShortDay(row.lastActiveAt)}</time> : <span className="text-fg-muted">Never</span>}
                  </td>
                  <td role="cell" className="py-1.5 pl-2 @max-[52rem]:block @max-[52rem]:p-0">
                    <span className="flex flex-wrap gap-x-4">
                      {row.personSlug ? (
                        <Link href={`/people/${row.personSlug}`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          Profile<span className="sr-only"> of {row.email}</span>
                        </Link>
                      ) : null}
                      {!row.suspended && row.role === 'user' ? (
                        <Link href={`/admin/accounts?email=${encodeURIComponent(row.email)}#suspend`} className="link inline-flex min-h-11 items-center whitespace-nowrap">
                          Suspend<span className="sr-only"> {row.email}</span>
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
        <nav aria-label="Pages of accounts" className="flex flex-wrap items-center gap-3 text-ui">
          {list.page > 1 ? (
            <Link href={accountsHref(filters, list.page - 1)} className={buttonVariants({ variant: 'secondary' })} rel="prev">
              Previous
            </Link>
          ) : null}
          <span className="text-fg-muted">
            Page {list.page} of {list.pages}
          </span>
          {list.page < list.pages ? (
            <Link href={accountsHref(filters, list.page + 1)} className={buttonVariants({ variant: 'secondary' })} rel="next">
              Next
            </Link>
          ) : null}
        </nav>
      ) : null}
    </div>
  );
}
