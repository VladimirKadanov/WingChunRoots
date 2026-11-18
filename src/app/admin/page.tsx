// /admin: the control panel's dashboard (owner request 2026-11-17, docs/adr/0035-control-panel.md;
// first built in M02 as a placeholder). Guarded by guardRoute (a staff role and a session that
// passed the second factor; other staff sessions are sent to /account/security). It shows counts
// only, from admin.dashboard and admin.overview: the archive's size and growth, where review work
// waits, what needs a look on the system, and, for administrators, the paid plans in test mode and
// the open account deletion requests. A member, or anyone without a session, never gets any of it
// (it is not rendered, not hidden). The navigation beside it is src/app/admin/layout.tsx.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { guardRoute } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Control panel'), robots: { index: false } };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** "4 days", "20 hours", "less than an hour" since `iso`, at `now`. */
function waited(t: AdminT, iso: string, now: string): string {
  const ms = Math.max(0, Date.parse(now) - Date.parse(iso));
  if (ms >= DAY_MS) return t.n(Math.floor(ms / DAY_MS), '{n} day', '{n} days');
  const hours = Math.floor(ms / (60 * 60 * 1000));
  return hours >= 1 ? t.n(hours, '{n} hour', '{n} hours') : t('less than an hour');
}

/** A review group's name (the keys of admin.dashboard, src/server/services/admin-dashboard.ts). */
function groupLabel(t: AdminT, key: string, label: string): string {
  switch (key) {
    case 'claims': return t('Historical and profile claims');
    case 'instructors': return t('Instructor checks');
    case 'schools': return t('School listings');
    case 'organizations': return t('Organizations');
    case 'records': return t('Record proposals');
    case 'disputes': return t('Disputes, reports and appeals');
    case 'deletions': return t('Account deletion requests');
    default: return label;
  }
}

function Card({ title, id, action, children, className }: { title: string; id: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={`min-w-0 rounded-md border border-border-subtle bg-surface-1 p-5 ${className ?? ''}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="font-display text-2xl">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Figure({ label, value, note, href, testId }: { label: string; value: string; note: string; href?: string; testId?: string }) {
  const body = (
    <>
      <span className="text-sm text-fg-muted">{label}</span>
      <span className="font-display text-2xl leading-none">{value}</span>
      <span className="text-sm text-fg-muted">{note}</span>
    </>
  );
  const box = 'grid min-w-0 content-start gap-1.5 rounded-md border border-border-subtle bg-surface-1 p-4';
  return href ? (
    <Link href={href} className={`${box} hover:border-border-strong`} data-testid={testId}>
      {body}
    </Link>
  ) : (
    <div className={box}>{body}</div>
  );
}

/** The weekly growth as a line chart: accounts in solid ink, people in a dashed second tone, with the numbers in a table for screen readers. */
function GrowthChart({ t, weeks }: { t: AdminT; weeks: { weekStart: string; accounts: number; people: number }[] }) {
  const W = 640;
  const H = 200;
  const left = 36;
  const top = 12;
  const bottom = 176;
  const max = Math.max(4, ...weeks.map((w) => Math.max(w.accounts, w.people)));
  const step = Math.ceil(max / 4);
  const ceiling = step * 4;
  const x = (i: number) => left + (i * (W - left - 8)) / Math.max(1, weeks.length - 1);
  const y = (v: number) => bottom - (v / ceiling) * (bottom - top);
  const line = (key: 'accounts' | 'people') => weeks.map((w, i) => `${x(i).toFixed(1)},${y(w[key]).toFixed(1)}`).join(' ');
  const last = weeks[weeks.length - 1];
  const total = (key: 'accounts' | 'people') => weeks.reduce((sum, w) => sum + w[key], 0);
  return (
    <figure className="relative mt-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <g key={i}>
            <line x1={left} x2={W - 8} y1={y(i * step)} y2={y(i * step)} stroke="var(--border-subtle)" />
            <text x={left - 8} y={y(i * step) + 4} textAnchor="end" fontSize="11" fill="var(--fg-subtle)">
              {i * step}
            </text>
          </g>
        ))}
        <text x={left} y={H - 4} fontSize="11" fill="var(--fg-subtle)">
          {t.day(weeks[0]!.weekStart)}
        </text>
        <text x={W - 8} y={H - 4} fontSize="11" fill="var(--fg-subtle)" textAnchor="end">
          {t('This week')}
        </text>
        <polyline points={line('people')} fill="none" stroke="var(--cross-lineage)" strokeWidth="2.5" strokeDasharray="6 4" strokeLinejoin="round" />
        <polyline points={line('accounts')} fill="none" stroke="var(--fg)" strokeWidth="2.5" strokeLinejoin="round" />
        {last ? <circle cx={x(weeks.length - 1)} cy={y(last.accounts)} r="4" fill="var(--fg)" /> : null}
      </svg>
      <figcaption className="mt-2 text-sm text-fg-muted">
        {t('In {weeks} weeks: {accounts} and {people} on record. This week so far: {thisAccounts} and {thisPeople}.', {
          weeks: weeks.length,
          accounts: t.n(total('accounts'), '{n} new account', '{n} new accounts'),
          people: t.n(total('people'), '{n} new person', '{n} new people'),
          thisAccounts: t.num(last?.accounts ?? 0),
          thisPeople: t.num(last?.people ?? 0),
        })}
      </figcaption>
      {/* A table ignores the 1 px width of sr-only: its wrapper takes it. */}
      <div className="sr-only">
        <table>
          <caption>{t('New accounts and new people on record per week')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('Week of')}</th>
              <th scope="col">{t('New accounts')}</th>
              <th scope="col">{t('New people')}</th>
            </tr>
          </thead>
          <tbody>
            {weeks.map((w) => (
              <tr key={w.weekStart}>
                <th scope="row">{t.day(w.weekStart)}</th>
                <td>{w.accounts}</td>
                <td>{w.people}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

function Legend({ t }: { t: AdminT }) {
  return (
    <span className="flex flex-wrap gap-x-4 text-sm text-fg-muted">
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden="true" width="18" height="4">
          <line x1="0" y1="2" x2="18" y2="2" stroke="var(--fg)" strokeWidth="2.5" />
        </svg>
        {t('New accounts')}
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg aria-hidden="true" width="18" height="4">
          <line x1="0" y1="2" x2="18" y2="2" stroke="var(--cross-lineage)" strokeWidth="2.5" strokeDasharray="4 3" />
        </svg>
        {t('New people on record')}
      </span>
    </span>
  );
}

/** A row of the "Needs attention" list: a shape and a word for its state, never colour alone. */
function Attention({ t, state, children, href, linkText, testId }: { t: AdminT; state: 'problem' | 'waiting' | 'fine'; children: ReactNode; href: string; linkText: string; testId?: string }) {
  const mark = { problem: '!', waiting: '⧗', fine: '✓' }[state];
  const word = { problem: t('Problem'), waiting: t('Waiting'), fine: t('Fine') }[state];
  const tone = { problem: 'text-danger font-bold', waiting: 'text-review', fine: 'text-verified' }[state];
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border-subtle py-2 text-ui">
      <span aria-hidden="true" className={`w-4 text-center ${tone}`}>
        {mark}
      </span>
      <span className="sr-only">{word}: </span>
      <span className="min-w-0 flex-1">{children}</span>
      <Link href={href} className="link inline-flex min-h-11 items-center" data-testid={testId}>
        {linkText}
      </Link>
    </li>
  );
}

function Column({ children }: { children: ReactNode }) {
  return <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-9 md:pb-14">{children}</div>;
}

export default async function AdminPage() {
  const guard = await guardRoute('/admin');
  const t = await getAdminT();
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) {
    return (
      <Column>
        <p className="eyebrow">{t('Staff')}</p>
        <h1 className="mt-2 font-display text-feature">{t('Not available')}</h1>
        <p className="mt-3 max-w-[56ch] text-fg-muted">{t('This page is for moderators, archivists and administrators.')}</p>
        <p className="mt-8 border-t border-border-subtle pt-5 text-ui">
          <Link href="/account" className="link inline-flex min-h-11 items-center">
            {t('Back to your account')}
          </Link>
        </p>
      </Column>
    );
  }
  const client = serverClient(await headers(), guard.principal);
  const [overview, d] = await Promise.all([client.admin.overview(), client.admin.dashboard()]);
  const role = guard.principal?.user.role;
  const isAdmin = role === 'admin';
  const failed = overview.failedEmailDeliveries;
  const reviewMax = Math.max(1, ...d.review.groups.map((g) => g.open));
  const usd = new Intl.NumberFormat(t.locale, { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 });
  const recent = (n: number) => t('{n} new', { n: t.num(n) });

  return (
    <Column>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{t('Control panel')}</p>
          <h1 className="mt-2 font-display text-feature">{t('Dashboard')}</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {t('Counted at {time} UTC on {day}. “New” means the last {days} days.', {
              time: new Date(d.checkedAt).toISOString().slice(11, 16),
              day: t.day(d.checkedAt),
              days: d.periodDays,
            })}
          </p>
        </div>
      </header>

      <section aria-label={t('Key figures')} className="mt-6 grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
        <Figure label={t('Accounts')} value={t.num(d.accounts.total)} note={recent(d.accounts.recent)} href={isAdmin ? '/admin/accounts' : undefined} testId={isAdmin ? 'admin-accounts-link' : undefined} />
        {isAdmin || role === 'archivist' ? (
          <Figure label={t('People on record')} value={t.num(d.people.total)} note={recent(d.people.recent)} href="/admin/archive" testId="archive-editor-link" />
        ) : (
          <Figure label={t('People on record')} value={t.num(d.people.total)} note={recent(d.people.recent)} />
        )}
        <Figure label={t('Verified links')} value={t.num(d.verifiedLinks.total)} note={t('{n} sealed lately', { n: t.num(d.verifiedLinks.recent) })} />
        <Figure
          label={t('Listed schools')}
          value={t.num(d.schools.listed)}
          note={t('{n} awaiting their Sifu', { n: t.num(d.schools.awaitingConfirmation) })}
          href={isAdmin || role === 'moderator' ? '/admin/schools' : undefined}
          testId={isAdmin || role === 'moderator' ? 'admin-schools-link' : undefined}
        />
        <Figure
          label={t('Open review requests')}
          value={t.num(d.review.open)}
          note={d.review.oldestOpenedAt ? t('oldest waits {time}', { time: waited(t, d.review.oldestOpenedAt, d.checkedAt) }) : t('none waiting')}
          href="/admin/review"
          testId="review-queue-link"
        />
        {d.billing ? (
          <Figure
            label={t('Monthly value, test mode')}
            value={usd.format(d.billing.monthlyCents / 100)}
            note={t.n(d.billing.paidPlans, '{n} paid plan', '{n} paid plans')}
            href="/admin/billing"
            testId="admin-billing-link"
          />
        ) : null}
      </section>

      <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] gap-4">
        <Card title={t('Growth')} id="growth-heading" action={<Legend t={t} />}>
          <GrowthChart t={t} weeks={d.growth} />
        </Card>

        <Card
          title={t('Review requests')}
          id="review-heading"
          action={
            <Link href="/admin/review" className="link inline-flex min-h-11 items-center text-ui">
              {t('Open the queue')}
            </Link>
          }
        >
          <p className="mt-1 text-sm text-fg-muted">
            {t('{cases} assigned to you · {unassigned} unassigned', {
              cases: t.n(d.review.assignedToMe, '{n} case is', '{n} cases are'),
              unassigned: t.num(d.review.unassigned),
            })}
          </p>
          <ul className="mt-3">
            {d.review.groups.map((g) => (
              <li key={g.key} className="grid min-h-11 grid-cols-[minmax(0,12rem)_1fr_2.5rem] items-center gap-3 border-t border-border-subtle text-ui">
                <span className="min-w-0">{groupLabel(t, g.key, g.label)}</span>
                <span aria-hidden="true" className="h-2.5 rounded-[2px] bg-surface-3">
                  <span className="block h-full rounded-[2px] bg-fg" style={{ width: `${(g.open / reviewMax) * 100}%` }} />
                </span>
                <span className="text-right font-semibold">{t.num(g.open)}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t('Needs attention')} id="attention-heading">
          <ul className="mt-3">
            <Attention t={t} state={d.system.failedJobs > 0 ? 'problem' : 'fine'} href="/admin/system" linkText={t('System status')} testId="system-status-link">
              {d.system.failedJobs > 0 ? <strong>{t.n(d.system.failedJobs, '{n} failed job', '{n} failed jobs')}</strong> : t('No failed jobs')}
            </Attention>
            <Attention t={t} state={failed > 0 ? 'problem' : 'fine'} href="/admin/system" linkText={t('Details')}>
              <span className="sr-only">{t('Failed e-mail deliveries:')} </span>
              <span data-testid="failed-email-deliveries" className="font-semibold">
                {failed}
              </span>{' '}
              {failed === 0
                ? t('failed e-mail deliveries: every e-mail was delivered or is still being sent.')
                : failed === 1
                  ? t('e-mail could not be delivered.')
                  : t('e-mails could not be delivered.')}
            </Attention>
            {isAdmin ? (
              <Attention t={t} state={d.deletionRequests > 0 ? 'waiting' : 'fine'} href="#deletion-requests" linkText={t('See below')}>
                {d.deletionRequests > 0 ? (
                  <strong>{t.n(d.deletionRequests, '{n} account deletion request', '{n} account deletion requests')}</strong>
                ) : (
                  t('No account deletion requests')
                )}
              </Attention>
            ) : null}
            {isAdmin || role === 'moderator' ? (
              <Attention t={t} state={d.schools.awaitingConfirmation + d.schools.pendingReview > 0 ? 'waiting' : 'fine'} href="/admin/schools" linkText={t('Schools')}>
                {t('{schools} their Sifu’s confirmation; {hidden} hidden from the map', {
                  schools: t.n(d.schools.awaitingConfirmation, '{n} school awaits', '{n} schools await'),
                  hidden: t.num(d.schools.hidden),
                })}
              </Attention>
            ) : null}
            <Attention t={t} state={d.system.lastBackupAt ? 'fine' : 'waiting'} href="/admin/system" linkText={t('Backups')}>
              {d.system.lastBackupAt ? t('Last local backup: {day}', { day: t.day(d.system.lastBackupAt) }) : t('No local backup yet')}
            </Attention>
          </ul>
        </Card>

        {d.billing ? (
          <Card
            title={t('Paid plans')}
            id="billing-heading"
            action={
              <Link href="/admin/billing" className="link inline-flex min-h-11 items-center text-ui">
                {t('Subscriptions')}
              </Link>
            }
          >
            <p className="mt-1 text-sm text-fg-muted">{t('Test mode, no real charge. Monthly value at the proposed prices; a yearly plan counts a twelfth.')}</p>
            <ul className="mt-3">
              {d.billing.byPlan.length === 0 ? <li className="border-t border-border-subtle py-3 text-ui text-fg-muted">{t('No paid plan yet.')}</li> : null}
              {d.billing.byPlan.map((plan) => (
                <li key={plan.code} className="flex min-h-11 items-center justify-between gap-3 border-t border-border-subtle text-ui">
                  <span>{plan.name}</span>
                  <span className="font-semibold">{t.num(plan.count)}</span>
                </li>
              ))}
              <li className="flex min-h-11 items-center justify-between gap-3 border-t border-border-subtle text-ui">
                <span>{t('Payment overdue')}</span>
                <span className="font-semibold">{t.num(d.billing.pastDue)}</span>
              </li>
            </ul>
            <p className="mt-3 text-ui">
              <Link href="/admin/organizations" className="link inline-flex min-h-11 items-center" data-testid="admin-organizations-link">
                {t('Organizations and their plans')}
              </Link>
            </p>
          </Card>
        ) : null}
      </div>

      {/* M07: open account deletion requests, for administrators (docs/guides/admin-guide.bg.md). */}
      {isAdmin ? (
        <section id="deletion-requests" aria-labelledby="deletion-requests-heading" className="mt-8 scroll-mt-4 border-t border-border-subtle pt-5">
          <h2 id="deletion-requests-heading" className="font-display text-2xl">
            {t('Account deletion requests')}
          </h2>
          {overview.deletionRequests.length === 0 ? (
            <p className="mt-3 text-ui text-fg-muted">
              {t('None open. When a member asks for their account to be deleted, the request appears here and you get a notification.')}
            </p>
          ) : (
            <>
              <p className="mt-3 max-w-[60ch] text-sm text-fg-muted">
                {t("Carry each request out with “Erase this account”: the account's data is erased and the links others confirmed stay as historical records until the legal review.")}
              </p>
              <ul className="mt-4 grid border-b border-border-subtle">
                {overview.deletionRequests.map((request) => (
                  <li key={request.caseId} data-deletion-request={request.caseId} className="grid gap-1 border-t border-border-subtle py-3 text-ui">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      {request.person ? (
                        <Link href={`/people/${request.person.slug}`} className="link font-semibold" lang={request.person.lang} translate="no">
                          {request.person.displayName}
                        </Link>
                      ) : (
                        <span className="font-semibold">{t('An account without a profile')}</span>
                      )}
                      {request.accountEmail ? (
                        <span translate="no" className="text-sm text-fg-muted [overflow-wrap:anywhere]">
                          {request.accountEmail}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-sm text-fg-muted">
                      {t('Asked on {day} · {status} · case', {
                        day: t.day(request.openedAt),
                        status: request.status === 'open' ? t('Open') : request.status === 'in_review' ? t('In review') : t('Needs information'),
                      })}{' '}
                      <span translate="no" className="font-mono">
                        {request.caseId}
                      </span>
                    </p>
                    <p>
                      <Link href={`/admin/accounts?case=${request.caseId}#erase`} className="link inline-flex min-h-11 items-center">
                        {t('Erase this account')}
                        {request.accountEmail ? <span className="sr-only"> {t('of {email}', { email: request.accountEmail })}</span> : null}
                      </Link>
                    </p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      ) : null}
    </Column>
  );
}
