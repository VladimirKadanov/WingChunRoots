// /dashboard/organization/<id>/import (milestone M24; specification §9.1;
// docs/adr/0027-organization-tools.md): the bulk import of an organization the signed-in account
// administers. The template's columns, the upload that checks a file (nothing is imported until
// the preview is confirmed), the earlier imports and the organization's teacher claims, each
// "claimed by the organization, not verified" (DEFAULT D12, M24 question 4).
//
// Any organization this account does not administer is "not found" (the services answer 404). The
// upload needs the approval and the Federation plan (DEFAULT D08); the list and the claims stay
// readable without it.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { claimForm, IMPORT_FORM } from '../../tools-form-ids';
import { ImportUploadForm, ToolButton } from '../../tools-forms';
import { Section, ToolNotFound, ToolPage, UUID } from '../../tools-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Import members',
  robots: { index: false },
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const DONE: Record<string, string> = {
  'claim-withdrawn': 'The claim was withdrawn. Nobody’s teachers or students changed.',
};

export default async function ImportPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = `/dashboard/organization/${UUID.test(id) ? id : ''}${UUID.test(id) ? '/import' : ''}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <ToolNotFound />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  const missing = (error: unknown) => {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing' as const;
    throw error;
  };
  const [org, list, claims] = await Promise.all([
    pageRead(client.organizations.manage({ organizationId: id }).catch(missing)),
    pageRead(client.organizationTools.imports({ organizationId: id }).catch(missing)),
    pageRead(client.organizationTools.claims({ organizationId: id }).catch(missing)),
  ]);
  if (org === 'missing' || list === 'missing' || claims === 'missing') return <ToolNotFound />;
  if (!org || !list || !claims) return <LoadError {...ORGANIZATION_LOAD_ERRORS.import} retryHref={page} />;
  const uploadResult = await readFormResult(IMPORT_FORM, query.outcome);
  const claimRows = await Promise.all(claims.claims.map(async (c) => ({ ...c, initial: await readFormResult(claimForm(c.id), query.outcome) })));
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;

  return (
    <ToolPage
      organizationId={org.id}
      title="Import members"
      testId="organization-import"
      intro={
        <>
          <p>
            Add the members of <span className="font-semibold text-fg">{org.name}</span> from a CSV file. You see every row and its problems first; nothing is imported until you confirm.
          </p>
          <p className="mt-2">{list.note}</p>
        </>
      }
    >
      {done ? <OutcomeNote testId="organization-import-done">{done}</OutcomeNote> : null}

      <Section id="import-template" title="The file" testId="organization-import-template">
        <p className="max-w-[62ch] text-sm text-fg-muted">The first line names the columns. First_Name is required; the other columns are optional and may be left empty.</p>
        <pre className="max-w-full rounded-sm bg-surface-2 px-4 py-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]" translate="no" data-testid="organization-import-header">
          <code>{list.template}</code>
        </pre>
        <ul className="grid max-w-[62ch] list-disc gap-1 pl-5 text-sm">
          <li>First_Name and Last_Name: the name in Latin letters. Chinese_Name: the name in Chinese characters.</li>
          <li>Start_Year: the year training began, such as 2015. Current_Rank and School_City: as your organization records them; they are never public.</li>
          <li>Sifu_Database_ID: the address of the teacher’s profile, such as /people/demo-hub-a: a public profile or a member of your organization. It becomes your organization’s claim, never a verified relationship.</li>
          <li>Email: not read. No one is invited or contacted by an import.</li>
          <li>A row whose name matches a current member is not imported, so no one is listed twice. Nobody is ever matched to an existing account.</li>
        </ul>
      </Section>

      <Section id="import-upload" title="Check a file">
        {org.can.administration ? (
          <ImportUploadForm organizationId={org.id} maxKb={256} maxRows={500} initial={uploadResult} />
        ) : (
          <p className="max-w-[60ch] rounded-sm bg-surface-2 px-4 py-4 text-ui" data-testid="organization-import-closed">
            {org.administrationNote ?? 'Imports are open to an approved organization with the Federation plan.'}
          </p>
        )}
      </Section>

      <Section id="import-history" title="Imports" testId="organization-imports">
        {list.imports.length > 0 ? (
          <ul className="grid gap-3">
            {list.imports.map((imp) => (
              <li key={imp.id} className="grid gap-0.5 border-b border-border-subtle pb-3" data-testid="organization-import-item" data-status={imp.status}>
                <Link href={`/dashboard/organization/${org.id}/import/${imp.id}`} className="link inline-flex min-h-11 items-center font-semibold">
                  {formatDay(imp.createdAt)} · {imp.rowCount} rows
                </Link>
                <span className="text-sm text-fg-muted">
                  {imp.statusLabel}
                  {imp.status === 'committed' ? ` · ${imp.importedCount} imported` : ` · ${imp.validCount} ready, ${imp.errorCount} with problems`}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-fg-muted">No file has been checked yet.</p>
        )}
      </Section>

      <Section id="import-claims" title="Teacher claims" testId="organization-claims">
        <p className="max-w-[62ch] text-sm text-fg-muted">{claims.note}</p>
        {claimRows.length > 0 ? (
          <ul className="grid gap-3">
            {claimRows.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-border-subtle pb-3" data-testid="organization-claim" data-status={c.status}>
                <span className="grid gap-0.5">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {c.student ? <PersonName person={c.student} className="text-base" /> : <span className="text-fg-muted">A removed record</span>}
                    <span className="text-sm text-fg-muted">trained with</span>
                    {c.teacher ? <PersonName person={c.teacher} className="text-base" /> : <span className="text-fg-muted">a removed profile</span>}
                  </span>
                  <span className="text-sm text-fg-muted">
                    {c.statusLabel}
                    {c.startYear ? ` · since ${c.startYear}` : ''}
                    {c.withdrawnBecause === 'separation' ? ' · the member left' : ''}
                  </span>
                </span>
                {c.status === 'claimed_by_organization' ? (
                  <ToolButton
                    kind="claim"
                    formId={claimForm(c.id)}
                    hidden={{ organizationId: org.id, claimId: c.id }}
                    label="Withdraw"
                    pendingLabel="Withdrawing…"
                    initial={c.initial}
                    testId="organization-claim-withdraw"
                    context={c.student?.name.value ?? 'claim'}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-ui text-fg-muted">Your organization has stated no teacher.</p>
        )}
      </Section>
    </ToolPage>
  );
}
