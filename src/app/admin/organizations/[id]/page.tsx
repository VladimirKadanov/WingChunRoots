// /admin/organizations/<id> (milestone M15): one organization's approval and plan, apart (DEFAULT
// D04), its plan grants with their reasons, and the forms to give a test or complimentary
// Federation plan (DEFAULT D09: "Proposed price (not final)"; nothing is charged) or to revoke one
// (DEFAULT D08: revoking closes only member and school administration; members, links and the
// public page stay). For administrators with a verified second factor. M23: the organization's
// Federation trial without a card (federationTrials.adminGet, start, end; docs/adr/0026-federation-billing.md).

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { getAdminT } from '@/components/admin/i18n/server';
import type { AdminT } from '@/components/admin/i18n/translate';
import { OutcomeNote } from '@/components/relationships/parts';
import { guardRoute } from '@/server/auth/web';
import { PLANS } from '@/server/entitlements/plans';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { TrialStatusTag } from '@/components/billing/status';
import { GRANT_FORM, revokeForm, TRIAL_END_FORM, TRIAL_START_FORM } from '../form-ids';
import { GrantForm, RevokeForm, TrialEndForm, TrialStartForm } from '../forms';
import { grantLabel, organizationLoadError, planLabel, serviceLabel, serviceMessage, trialStatusLabel, trialSummary } from '../labels';
import { loadErrorWords } from '@/components/admin/i18n/load-error-words';

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getAdminT();
  return { title: t('Organization'), robots: { index: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

function doneText(t: AdminT, done: unknown): string | undefined {
  switch (done) {
    case 'granted': return t('Federation was given. The organization’s admins can manage members and schools while it holds.');
    case 'revoked': return t('The grant was revoked. Members, school links and the public page stay; member and school administration is closed.');
    case 'trial-started': return t('The Federation trial started. The organization’s admins were told; no card is needed and nothing is charged.');
    case 'trial-ended': return t('The trial was ended. Members, school links and the public page stay; nothing was charged.');
    default: return undefined;
  }
}

async function NotFound() {
  const t = await getAdminT();
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="admin-organization-not-found">
      <p className="eyebrow">
        <Link href="/admin/organizations" className="link inline-flex min-h-11 items-center">
          {t('Organizations')}
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">{t('Organization not found')}</h1>
    </div>
  );
}

export default async function AdminOrganizationPage({ params, searchParams }: Props) {
  const { id } = await params;
  const t = await getAdminT();
  const page = `/admin/organizations/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/admin" />;
  if (!UUID.test(id)) return <NotFound />;
  const query = await searchParams;
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .organizations.adminGet({ organizationId: id })
      .catch((error: unknown) => {
        if (rpcErrorCode(error) === 'NOT_FOUND') return 'missing' as const;
        throw error;
      }),
  );
  if (read === 'missing') return <NotFound />;
  const org = read;
  if (!org) return <LoadError words={loadErrorWords(t)} {...organizationLoadError(t)} retryHref={page} />;
  const grantResult = await readFormResult(GRANT_FORM, query.outcome);
  const trial = await pageRead(serverClient(await headers(), guard.principal).federationTrials.adminGet({ organizationId: id }));
  const [trialStartResult, trialEndResult] = await Promise.all([readFormResult(TRIAL_START_FORM, query.outcome), readFormResult(TRIAL_END_FORM, query.outcome)]);
  const grants = await Promise.all(org.grants.map(async (g) => ({ ...g, initial: await readFormResult(revokeForm(g.id), query.outcome) })));
  const done = doneText(t, query.done);
  const federation = PLANS.federation;

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="admin-organization-page">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/admin/organizations" className="link inline-flex min-h-11 items-center">
            {t('Organizations')}
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{org.name}</h1>
        <p className="mt-2 text-ui text-fg-muted">
          {serviceLabel(t, org.kindLabel)}
          {org.countryCode ? ` · ${org.countryCode}` : ''} · {t.n(org.admins, '{n} admin', '{n} admins')}
        </p>
        <dl className="mt-5 grid gap-2 text-ui sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6">
          <dt className="text-fg-muted">{t('Approval')}</dt>
          <dd className="font-semibold" data-testid="admin-organization-approval">
            {serviceLabel(t, org.approvalLabel)}
          </dd>
          <dt className="text-fg-muted">{t('Plan')}</dt>
          <dd className="font-semibold" data-testid="admin-organization-plan" data-plan={org.plan.code ?? 'none'}>
            {planLabel(t, org.plan.label)}
            {org.plan.until ? <span className="font-normal text-fg-muted">{t(' · until {date}', { date: t.day(org.plan.until) })}</span> : null}
          </dd>
        </dl>
        <p className="mt-3 flex flex-wrap gap-x-6 text-sm">
          {org.caseId ? (
            <Link href={`/admin/review/${org.caseId}`} className="link inline-flex min-h-11 items-center">
              {t('Open the application in the review queue')}
            </Link>
          ) : null}
          {org.status === 'active' ? (
            <Link href={`/organizations/${org.slug}`} className="link inline-flex min-h-11 items-center">
              {t('Public page')}
            </Link>
          ) : null}
        </p>

        <div className="mt-8 grid gap-10">
          {done ? <OutcomeNote testId="admin-organization-done">{done}</OutcomeNote> : null}

          <section aria-labelledby="organization-grants" className="grid gap-4 border-t border-border-subtle pt-6">
            <h2 id="organization-grants" className="font-display text-2xl">
              {t('Plan grants')}
            </h2>
            {grants.length === 0 ? (
              <p className="text-ui text-fg-muted">{t('No plan was ever given.')}</p>
            ) : (
              <ul className="grid gap-4">
                {grants.map((g) => (
                  <li key={g.id} className="grid gap-2 border-b border-border-subtle pb-4" data-testid="organization-grant" data-state={g.state}>
                    <p className="font-semibold">
                      {g.planName} · {grantLabel(t, g.sourceLabel)} · {grantLabel(t, g.stateLabel)}
                    </p>
                    <p className="text-sm text-fg-muted">
                      {g.endsAt ? t('From {from} to {to}', { from: t.day(g.startsAt), to: t.day(g.endsAt) }) : t('From {from}, no end date', { from: t.day(g.startsAt) })}
                      {g.grantedBy ? t(' · by {email}', { email: g.grantedBy }) : ''}
                    </p>
                    <p className="text-sm whitespace-pre-line">
                      <span className="text-fg-muted">{t('Reason: ')}</span>
                      {g.reason}
                    </p>
                    {g.revokeReason ? (
                      <p className="text-sm whitespace-pre-line">
                        <span className="text-fg-muted">{t('Revoked: ')}</span>
                        {g.revokeReason}
                      </p>
                    ) : null}
                    {g.state === 'active' || g.state === 'scheduled' ? <RevokeForm organizationId={org.id} grantId={g.id} initial={g.initial} /> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {trial ? (
            <section aria-labelledby="organization-trial" className="grid gap-4 border-t border-border-subtle pt-6" data-testid="admin-organization-trial">
              <h2 id="organization-trial" className="font-display text-2xl">
                {t('{plan} trial', { plan: federation.name })}
              </h2>
              <p className="max-w-[60ch] text-sm text-fg-muted">
                {t('A trial without a card. The organization’s admins are told when it starts, 14 and 7 days before it ends and when it ends. If no owner subscribes, it simply ends: nothing is charged and nothing is deleted.')}
              </p>
              {trial.trial ? (
                <div className="grid gap-2" data-testid="organization-trial" data-status={trial.trial.status}>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="font-semibold">{t.n(trial.trial.months, '{n} month', '{n} months')}</span>
                    <TrialStatusTag status={trial.trial.status} label={trialStatusLabel(t, trial.trial.statusLabel)} />
                  </p>
                  <p className="text-sm text-fg-muted" data-visual-date="">
                    {t('From {from} to {to}', { from: t.day(trial.trial.startsAt), to: t.day(trial.trial.endsAt) })}
                  </p>
                  <p className="max-w-[60ch] text-sm" data-visual-date="">
                    {trialSummary(t, trial.trial)}
                  </p>
                  {trial.canEnd ? <TrialEndForm organizationId={org.id} trialId={trial.trial.id} initial={trialEndResult} /> : null}
                </div>
              ) : null}
              {trial.canStart ? (
                <TrialStartForm organizationId={org.id} months={trial.months} defaultMonths={trial.defaultMonths} initial={trialStartResult} />
              ) : !trial.trial ? (
                <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-trial-note">
                  {trial.startNote ? serviceMessage(t, trial.startNote) : null}
                </p>
              ) : null}
            </section>
          ) : null}

          <section aria-labelledby="organization-give" className="grid gap-4 border-t border-border-subtle pt-6">
            <h2 id="organization-give" className="font-display text-2xl">
              {t('Give {plan}', { plan: federation.name })}
            </h2>
            <p className="max-w-[60ch] text-sm text-fg-muted">
              {t('A test or complimentary plan only; nothing is charged. {plan}’s price is a proposed price (not final).', { plan: federation.name })}
            </p>
            {org.canGrant ? (
              <GrantForm organizationId={org.id} initial={grantResult} />
            ) : (
              <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-grant-note">
                {org.grantNote ? serviceMessage(t, org.grantNote) : null}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
