// /dashboard/organization/<id> (milestone M15; docs/adr/0018-organizations.md): one organization
// the signed-in account administers. Three states are shown apart (DEFAULT D04): the approval (the
// reviewers'), the plan (an administrator's test or complimentary Federation grant, DEFAULT D09)
// and, elsewhere, each person's own verification. While the application waits the page edits only
// the application (DEFAULT: a pending organization edits only its own application); once approved
// it edits the website, the leader and the number of schools. Members and school links need the
// approval and the Federation plan (DEFAULT D08): without the plan they are shown, not managed.
// No action here creates, verifies or edits a teaching relationship (DEFAULT D12).
//
// Any other organization, and one this account does not administer, is "not found" (the service
// answers 404), so the page never says whether it exists.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { formatSize } from '@/lib/file-size';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ADD_ADMIN_FORM, ADD_MEMBER_FORM, DETAILS_FORM, REQUEST_SCHOOL_FORM, rowForm } from '../form-ids';
import { AddAdminForm, AddMemberForm, DetailsForm, RequestSchoolForm, RowAction } from '../forms';

export const instant = false;

export const metadata: Metadata = {
  title: 'Organization',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const DONE: Record<string, string> = {
  applied: 'Your application was sent. The reviewers check it; you get a notification when they decide or ask you something.',
  saved: 'Saved.',
  'admin-added': 'The admin was added and told.',
  'admin-removed': 'The admin was removed.',
  'member-added': 'The member is listed. Nothing changed in anyone’s teachers or students.',
  'member-ended': 'The membership ended today. It stays in the organization’s history; your organization’s rank, city and claims for the person were removed.',
  'school-requested': 'The school was asked. Its account accepts or refuses the link.',
  'school-ended': 'The school link ended. The school and its pin did not change.',
};

function Section({ id, title, children, testId }: { id: string; title: string; children: ReactNode; testId?: string }) {
  return (
    <section aria-labelledby={id} className="grid gap-4 border-t border-border-subtle pt-6" data-testid={testId}>
      <h2 id={id} className="font-display text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-not-found">
      <p className="eyebrow">
        <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
          Your organizations
        </Link>
      </p>
      <h1 className="mt-2 font-display text-feature">Organization not found</h1>
      <p className="mt-3 max-w-[56ch] text-fg-muted">There is no organization at this address that your account administers.</p>
    </div>
  );
}

export default async function ManageOrganizationPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = `/dashboard/organization/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <NotFound />;
  const query = await searchParams;
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .organizations.manage({ organizationId: id })
      .catch((error: unknown) => {
        if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing' as const;
        throw error;
      }),
  );
  if (read === 'missing') return <NotFound />;
  const org = read;
  if (!org) return <LoadError {...ORGANIZATION_LOAD_ERRORS.manage} retryHref={page} />;

  const [detailsResult, adminResult, memberResult, schoolResult] = await Promise.all([
    readFormResult(DETAILS_FORM, query.outcome),
    readFormResult(ADD_ADMIN_FORM, query.outcome),
    readFormResult(ADD_MEMBER_FORM, query.outcome),
    readFormResult(REQUEST_SCHOOL_FORM, query.outcome),
  ]);
  const rowResult = async (kind: 'admin' | 'member' | 'school', rowId: string) => readFormResult(rowForm(kind, rowId), query.outcome);
  const adminRows = await Promise.all(org.admins.map(async (a) => ({ ...a, initial: await rowResult('admin', a.id) })));
  const memberRows = await Promise.all(org.members.map(async (m) => ({ ...m, initial: await rowResult('member', m.id) })));
  const schoolRows = await Promise.all(org.schools.map(async (s) => ({ ...s, initial: await rowResult('school', s.id) })));
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;
  const app = org.application;
  const editable = org.can.editApplication || org.can.editDetails;
  const defaults = {
    name: org.name,
    kind: org.kind,
    leaderName: org.leaderName ?? '',
    leaderTitle: org.leaderTitle ?? '',
    websiteUrl: org.websiteUrl ?? '',
    countryCode: org.countryCode ?? '',
    schoolsEstimate: org.schoolsEstimate === null ? '' : String(org.schoolsEstimate),
  };

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-manage" data-status={org.approval.status}>
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/organization" className="link inline-flex min-h-11 items-center">
            Your organizations
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{org.name}</h1>
        <p className="mt-2 text-ui text-fg-muted">
          {org.kindLabel} · You: {org.you.roleLabel}
        </p>

        {/* DEFAULT D04: the approval and the plan, two states in words. */}
        <dl className="mt-5 grid gap-2 text-ui sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-6" data-testid="organization-states">
          <dt className="text-fg-muted">Approval</dt>
          <dd className="font-semibold" data-testid="organization-approval" data-status={org.approval.status}>
            {org.approval.label}
            {org.approval.approvedAt ? <span className="font-normal text-fg-muted"> · since {formatDay(org.approval.approvedAt)}</span> : null}
          </dd>
          <dt className="text-fg-muted">Plan</dt>
          <dd className="font-semibold" data-testid="organization-plan" data-plan={org.plan.code ?? 'none'}>
            {org.plan.label}
            {org.plan.until ? <span className="font-normal text-fg-muted"> · until {formatDay(org.plan.until)}</span> : null}
          </dd>
        </dl>
        <p className="mt-3 max-w-[60ch] text-sm text-fg-muted">
          Approval is not a verification: it says the organization exists, not who taught whom. Each person’s teachers and students are verified by those people alone.
        </p>
        {org.approval.status === 'active' ? (
          <p className="mt-3">
            <Link href={`/organizations/${org.slug}`} className="link inline-flex min-h-11 items-center" data-testid="organization-public-link">
              Open the public page
            </Link>
          </p>
        ) : null}

        <div className="mt-8 grid gap-10">
          {done ? <OutcomeNote testId="organization-done">{done}</OutcomeNote> : null}

          {app ? (
            <Section id="organization-application" title="The application" testId="organization-application">
              <p className="text-sm font-semibold" data-status={app.status}>
                {app.statusLabel}
              </p>
              {app.reason ? (
                <p className="max-w-[60ch] text-sm whitespace-pre-line" data-testid="organization-reason">
                  <span className="font-semibold">Reviewers: </span>
                  {app.reason}
                </p>
              ) : null}
              {app.messages.length > 0 ? (
                <ul className="grid gap-2 text-sm">
                  {app.messages.map((message, i) => (
                    <li key={i} className="grid gap-0.5">
                      <span className="font-semibold">{message.fromYou ? 'Your note' : 'The reviewers ask'}</span>
                      <span className="whitespace-pre-line">{message.body}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {app.files.length > 0 ? (
                <ul className="grid gap-1 text-sm" data-testid="organization-files">
                  {app.files.map((file) => (
                    <li key={file.id}>
                      {file.href ? (
                        <a href={file.href} className="link inline-flex min-h-11 items-center" translate="no">
                          {file.name ?? `${file.kindLabel} file`}
                        </a>
                      ) : (
                        <span translate="no">{file.name ?? `${file.kindLabel} file`}</span>
                      )}{' '}
                      <span className="text-fg-muted">
                        · {file.kindLabel} · {formatSize(file.sizeBytes)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {app.open ? (
                <p className="text-sm">
                  <Link href={`/dashboard/cases/${app.caseId}`} className="link inline-flex min-h-11 items-center" data-testid="organization-case-link">
                    Answer the reviewers or add a document
                  </Link>
                </p>
              ) : null}
            </Section>
          ) : null}

          {editable ? (
            <Section id="organization-details" title={org.can.editApplication ? 'Edit the application' : 'Details'}>
              <DetailsForm
                organizationId={org.id}
                defaults={defaults}
                initial={detailsResult}
                countries={org.countries}
                kinds={org.kinds}
                locked={!org.can.editApplication}
              />
            </Section>
          ) : null}

          {org.approval.status === 'active' ? (
            <>
              <Section id="organization-admins" title="Admins" testId="organization-admins">
                <p className="max-w-[60ch] text-sm text-fg-muted">Accounts that manage this organization. Being an admin does not make anyone a member, and a member is not an admin.</p>
                <ul className="grid gap-3">
                  {adminRows.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle pb-3" data-testid="organization-admin">
                      <span className="grid gap-0.5">
                        <span className="[overflow-wrap:anywhere]" translate="no">
                          {a.label}
                        </span>
                        <span className="text-sm text-fg-muted">
                          {a.roleLabel}
                          {a.you ? ' · you' : ''}
                        </span>
                      </span>
                      {a.role !== 'owner' && (org.can.manageAdmins || a.you) ? (
                        <RowAction
                          kind="admin"
                          formId={rowForm('admin', a.id)}
                          hidden={{ organizationId: org.id, adminId: a.id, ...(a.you ? { self: '1' } : {}) }}
                          label={a.you ? 'Leave' : 'Remove'}
                          pendingLabel={a.you ? 'Leaving…' : 'Removing…'}
                          initial={a.initial}
                          testId="organization-admin-remove"
                          context={a.you ? 'stop being an admin' : a.label}
                        />
                      ) : null}
                    </li>
                  ))}
                </ul>
                {org.can.manageAdmins ? <AddAdminForm organizationId={org.id} initial={adminResult} /> : null}
              </Section>

              {org.administrationNote ? (
                <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-administration-note">
                  {org.administrationNote}
                </p>
              ) : null}

              {/* M24: the organization tools; each page says what it needs when the plan is missing. */}
              <Section id="organization-tools" title="Tools" testId="organization-tools">
                <ul className="grid gap-1 sm:grid-cols-3">
                  <li>
                    <Link href={`/dashboard/organization/${org.id}/import`} className="link inline-flex min-h-11 items-center font-semibold" data-testid="organization-tools-import">
                      Import members
                    </Link>
                  </li>
                  <li>
                    <Link href={`/dashboard/organization/${org.id}/analytics`} className="link inline-flex min-h-11 items-center font-semibold" data-testid="organization-tools-analytics">
                      Analytics
                    </Link>
                  </li>
                  <li>
                    <Link href={`/dashboard/organization/${org.id}/heatmap`} className="link inline-flex min-h-11 items-center font-semibold" data-testid="organization-tools-heatmap">
                      School heatmap
                    </Link>
                  </li>
                </ul>
              </Section>

              <Section id="organization-members" title="Members" testId="organization-members">
                <p className="max-w-[60ch] text-sm text-fg-muted">
                  People with a public profile who belong to the organization, and the private records of your imports. Listing someone is not a verification and changes nobody’s teachers or students.
                </p>
                <p className="max-w-[60ch] text-sm text-fg-muted" data-testid="organization-separation-rules">
                  Ending a membership needs nobody’s approval. It stays in the history; your organization’s rank, city and teacher claims for the person are removed, and the person’s account is told. Their profile, teachers and students do not change.
                </p>
                {memberRows.length > 0 ? (
                  <ul className="grid gap-3">
                    {memberRows.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle pb-3" data-testid="organization-member" data-current={m.current}>
                        <span className="grid gap-0.5">
                          <PersonName person={m.person} link={!m.recordOnly} className="text-base" />
                          <span className="text-sm text-fg-muted">
                            {m.recordOnly ? 'Private record · ' : ''}
                            {m.roleLabel}
                            {m.startsOn ? ` · since ${formatDay(m.startsOn)}` : ''}
                            {m.endsOn ? ` · ended ${formatDay(m.endsOn)}` : ''}
                          </span>
                        </span>
                        {m.current && org.can.administration ? (
                          <RowAction
                            kind="member"
                            formId={rowForm('member', m.id)}
                            hidden={{ organizationId: org.id, membershipId: m.id }}
                            label="End membership"
                            pendingLabel="Ending…"
                            initial={m.initial}
                            testId="organization-member-end"
                            context={m.person.name.value}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ui text-fg-muted">No members are listed.</p>
                )}
                {org.can.administration ? <AddMemberForm organizationId={org.id} roles={org.memberRoles} initial={memberResult} /> : null}
              </Section>

              <Section id="organization-schools" title="Schools" testId="organization-schools">
                <p className="max-w-[60ch] text-sm text-fg-muted">Schools that accepted the organization’s link. The school’s account decides; the school and its pin never change.</p>
                {schoolRows.length > 0 ? (
                  <ul className="grid gap-3">
                    {schoolRows.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle pb-3" data-testid="organization-school" data-status={s.status}>
                        <span className="grid gap-0.5">
                          <Link href={`/schools/${s.slug}`} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]">
                            {s.name}
                          </Link>
                          <span className="text-sm text-fg-muted">
                            {s.city}, {s.countryCode} · {s.statusLabel}
                          </span>
                        </span>
                        {org.can.administration ? (
                          <RowAction
                            kind="school"
                            formId={rowForm('school', s.id)}
                            hidden={{ organizationId: org.id, linkId: s.id }}
                            label={s.status === 'pending' ? 'Withdraw' : 'End link'}
                            pendingLabel="Ending…"
                            initial={s.initial}
                            testId="organization-school-end"
                            context={s.name}
                          />
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-ui text-fg-muted">No school is linked.</p>
                )}
                {org.can.administration ? <RequestSchoolForm organizationId={org.id} initial={schoolResult} /> : null}
              </Section>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
