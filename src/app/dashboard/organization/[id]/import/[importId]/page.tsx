// /dashboard/organization/<id>/import/<importId> (milestone M24; docs/adr/0027-organization-tools.md):
// one import's preview, or what it did. Every row with its outcome in words and its problems by
// column; "Import the valid rows" and "Discard" while the preview is open (24 hours). Once the
// import has ended its rows show only their outcome (the parsed fields are cleared, plan §6.4).
// Any import outside the organizations this account administers is "not found".

import type { Metadata } from 'next';
import { headers } from 'next/headers';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote, PersonName } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { importForm } from '../../../tools-form-ids';
import { ToolButton } from '../../../tools-forms';
import { Section, ToolNotFound, ToolPage, UUID } from '../../../tools-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Import',
  robots: { index: false },
};

type Props = { params: Promise<{ id: string; importId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const DONE: Record<string, string> = {
  checked: 'The file was checked. Nothing is imported until you confirm below.',
  imported: 'The valid rows were imported as private records of your organization. Nobody was contacted and no relationship was verified.',
  discarded: 'The preview was discarded. Nothing was imported.',
};

export default async function ImportDetailPage({ params, searchParams }: Props) {
  const { id, importId } = await params;
  const valid = UUID.test(id) && UUID.test(importId);
  const page = valid ? `/dashboard/organization/${id}/import/${importId}` : '/dashboard/organization';
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!valid) return <ToolNotFound what="import" />;
  const query = await searchParams;
  const read = await pageRead(
    serverClient(await headers(), guard.principal)
      .organizationTools.importGet({ organizationId: id, importId })
      .catch((error: unknown) => {
        if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return 'missing' as const;
        throw error;
      }),
  );
  if (read === 'missing') return <ToolNotFound what="import" />;
  if (!read) return <LoadError {...ORGANIZATION_LOAD_ERRORS.import} retryHref={page} />;
  const imp = read;
  const [commitResult, discardResult] = await Promise.all([readFormResult(importForm('commit', imp.id), query.outcome), readFormResult(importForm('discard', imp.id), query.outcome)]);
  const done = typeof query.done === 'string' ? DONE[query.done] : undefined;
  const open = imp.status === 'previewed';

  return (
    <ToolPage
      organizationId={id}
      title={open ? 'Check the import' : 'Import'}
      testId="organization-import-detail"
      intro={
        <>
          <p data-testid="organization-import-status" data-status={imp.status}>
            <span className="font-semibold text-fg">{imp.statusLabel}</span> · checked {formatDay(imp.createdAt)}
            {open ? ` · can be imported until ${formatDay(imp.expiresAt)}` : ''}
          </p>
          <p className="mt-2">{imp.note}</p>
        </>
      }
    >
      {done ? <OutcomeNote testId="organization-import-done">{done}</OutcomeNote> : null}

      <dl className="grid max-w-[40rem] grid-cols-2 gap-x-6 gap-y-2 text-ui sm:grid-cols-4" data-testid="organization-import-counts">
        <div>
          <dt className="text-sm text-fg-muted">Rows</dt>
          <dd className="font-display text-2xl">{imp.rowCount}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Ready</dt>
          <dd className="font-display text-2xl">{imp.validCount}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">With problems</dt>
          <dd className="font-display text-2xl">{imp.errorCount}</dd>
        </div>
        <div>
          <dt className="text-sm text-fg-muted">Imported</dt>
          <dd className="font-display text-2xl">{imp.importedCount}</dd>
        </div>
      </dl>

      {imp.can.commit || imp.can.discard ? (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3" data-testid="organization-import-actions">
          {imp.can.commit ? (
            <ToolButton
              kind="commit"
              primary
              formId={importForm('commit', imp.id)}
              hidden={{ organizationId: id, importId: imp.id }}
              label={`Import ${imp.validCount} valid ${imp.validCount === 1 ? 'row' : 'rows'}`}
              pendingLabel="Importing…"
              initial={commitResult}
              testId="organization-import-commit"
            />
          ) : null}
          {imp.can.discard ? (
            <ToolButton
              kind="discard"
              formId={importForm('discard', imp.id)}
              hidden={{ organizationId: id, importId: imp.id }}
              label="Discard"
              pendingLabel="Discarding…"
              initial={discardResult}
              testId="organization-import-discard"
              context="this preview"
            />
          ) : null}
        </div>
      ) : null}

      <Section id="import-rows" title="Rows" testId="organization-import-rows">
        {!open ? <p className="max-w-[62ch] text-sm text-fg-muted">The rows’ fields are no longer kept; each row shows what happened to it.</p> : null}
        <ol className="grid gap-3">
          {imp.rows.map((row) => (
            <li key={row.rowNumber} className="grid gap-1 border-b border-border-subtle pb-3" data-testid="organization-import-row" data-status={row.status}>
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                <span className="text-sm text-fg-muted">Row {row.rowNumber}</span>
                {row.name ? (
                  <span className="font-semibold [overflow-wrap:anywhere]" lang="und-Latn" translate="no">
                    {row.name}
                  </span>
                ) : row.person ? (
                  <PersonName person={row.person} className="font-semibold" />
                ) : null}
                {row.chineseName ? (
                  <span lang="zh-Hant" translate="no" className="text-fg-muted">
                    {row.chineseName}
                  </span>
                ) : null}
              </p>
              <p className="text-sm">
                {/* The outcome in words and a mark, never colour alone. */}
                <span className="font-semibold">
                  <span aria-hidden="true">{row.status === 'error' || row.status === 'skipped' ? '✕ ' : '✓ '}</span>
                  {row.statusLabel}
                </span>
                {row.startYear ? <span className="text-fg-muted"> · since {row.startYear}</span> : null}
                {row.rank ? <span className="text-fg-muted"> · {row.rank}</span> : null}
                {row.schoolCity ? <span className="text-fg-muted"> · {row.schoolCity}</span> : null}
              </p>
              {row.teacher ? (
                <p className="flex flex-wrap items-baseline gap-x-1.5 text-sm text-fg-muted">
                  Teacher claimed by the organization: <PersonName person={row.teacher} className="text-sm text-fg" />
                </p>
              ) : null}
              {row.errors.length > 0 ? (
                <ul className="grid gap-0.5 pl-5 text-sm" data-testid="organization-import-row-errors">
                  {row.errors.map((e, i) => (
                    <li key={i} className="list-disc">
                      {e.field === 'row' ? '' : <span className="font-semibold" translate="no">{e.field}: </span>}
                      {e.message}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </Section>
    </ToolPage>
  );
}
