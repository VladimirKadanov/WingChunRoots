// /dashboard/organization/<id>/claim-links (role replay 2026-11-25, P2-6, ADR 0074): the members
// this organization's imports created whose records are still unclaimed, each with a claim link
// the admin passes on themself (by their own e-mail, a printed sheet, a chat). WingChunRoots sends
// nothing: the import never reads the Email column. Opening a link lets the member ask to claim
// their record; the reviewers decide, as for any claim. "Make claim links" makes one for every
// member without one; "Replace the link" makes a new one (the old one stops working).
//
// Any organization this account does not administer is "not found". Making links needs the
// approval and the Federation plan (DEFAULT D08), like the import.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { ORGANIZATION_LOAD_ERRORS } from '@/components/account/organization-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { OutcomeNote } from '@/components/relationships/parts';
import { formatDay } from '@/lib/dates';
import { appUrl } from '@/server/auth/env';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { MAKE_CLAIM_LINKS_FORM, replaceLinkForm } from '../../tools-form-ids';
import { ToolButton } from '../../tools-forms';
import { Section, ToolClosed, ToolNotFound, ToolPage, UUID } from '../../tools-parts';

export const instant = false;

export const metadata: Metadata = {
  title: 'Claim links',
  robots: { index: false },
  // The links are secrets: the Referer goes only to this site.
  referrer: 'same-origin',
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function ClaimLinksPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = UUID.test(id) ? `/dashboard/organization/${id}/claim-links` : '/dashboard/organization';
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!UUID.test(id)) return <ToolNotFound />;
  const query = await searchParams;
  const client = serverClient(await headers(), guard.principal);
  let view;
  try {
    view = await pageRead(client.organizationTools.claimLinks({ organizationId: id }));
  } catch (error) {
    const code = rpcErrorCode(error);
    if (code === 'NOT_FOUND' || code === 'BAD_REQUEST') return <ToolNotFound />;
    if (code === 'CONFLICT' || code === 'ENTITLEMENT_REQUIRED') {
      return <ToolClosed organizationId={id} title="Claim links" message="Claim links are open to an approved organization with the Federation plan, like the import." />;
    }
    throw error;
  }
  if (!view) return <LoadError {...ORGANIZATION_LOAD_ERRORS.import} retryHref={page} />;
  const makeResult = await readFormResult(MAKE_CLAIM_LINKS_FORM, query.outcome);
  const rows = await Promise.all(view.members.map(async (m) => ({ ...m, initial: await readFormResult(replaceLinkForm(m.personId), query.outcome) })));
  const made = typeof query.made === 'string' && /^\d{1,4}$/.test(query.made) ? Number(query.made) : null;
  const replaced = typeof query.replaced === 'string' && UUID.test(query.replaced) ? query.replaced : null;
  const origin = new URL(appUrl()).origin;

  return (
    <ToolPage
      organizationId={view.organization.id}
      title="Claim links"
      testId="organization-claim-links"
      intro={
        <>
          <p>
            Each member your imports added to <span className="font-semibold text-fg">{view.organization.name}</span> can claim their record with their own link. Pass each link on
            yourself, by your own e-mail or on paper: WingChunRoots sends nothing.
          </p>
          <p className="mt-2">
            A link does not sign anyone in. Whoever opens it asks to claim the record, and a reviewer checks the claim first. Give each link only to the member it names.
          </p>
        </>
      }
    >
      {made !== null ? (
        <OutcomeNote testId="claim-links-made">{made === 0 ? 'Every member already has a link.' : made === 1 ? 'One new claim link is ready.' : `${made} new claim links are ready.`}</OutcomeNote>
      ) : replaced ? (
        <OutcomeNote testId="claim-link-replaced">The new link is ready. The old one no longer works.</OutcomeNote>
      ) : null}

      <Section id="claim-links-make" title="Make the links">
        {view.members.length === 0 ? (
          <p className="text-ui text-fg-muted" data-testid="claim-links-empty">
            No imported member is waiting to claim a record. Members who claimed theirs, and those who left, are not listed.
          </p>
        ) : view.withoutLink > 0 ? (
          <ToolButton
            kind="makeLinks"
            formId={MAKE_CLAIM_LINKS_FORM}
            hidden={{ organizationId: view.organization.id }}
            label={view.withoutLink === 1 ? 'Make a claim link for one member' : `Make claim links for ${view.withoutLink} members`}
            pendingLabel="Making the links…"
            initial={makeResult}
            testId="claim-links-make"
            primary
          />
        ) : (
          <p className="text-ui text-fg-muted">Every member below has a link.</p>
        )}
      </Section>

      {view.members.length > 0 ? (
        <Section id="claim-links-list" title="Members and their links" testId="claim-links-list">
          <ul className="grid gap-4">
            {rows.map((m) => (
              <li key={m.personId} className="grid gap-2 border-b border-border-subtle pb-4" data-testid="claim-link-member" data-has-link={m.link ? 'yes' : 'no'}>
                <span className="flex flex-wrap items-baseline gap-x-3">
                  <span lang={m.name.lang} translate="no" className="font-display text-lg">
                    {m.name.value}
                  </span>
                  {m.claimWaiting ? (
                    <span className="text-sm font-semibold" data-testid="claim-link-waiting">
                      Claim waiting for the reviewers
                    </span>
                  ) : null}
                </span>
                {m.link ? (
                  <>
                    <code className="block max-w-full rounded-sm bg-surface-2 px-3 py-2 text-sm [overflow-wrap:anywhere]" translate="no" data-testid="claim-link-url">
                      {`${origin}${m.link.path}`}
                    </code>
                    <span className="text-sm text-fg-muted">Made {formatDay(m.link.createdAt)}</span>
                    <ToolButton
                      kind="replaceLink"
                      formId={replaceLinkForm(m.personId)}
                      hidden={{ organizationId: view.organization.id, personId: m.personId }}
                      label="Replace the link"
                      pendingLabel="Replacing…"
                      initial={m.initial}
                      testId="claim-link-replace"
                      context={m.name.value}
                    />
                  </>
                ) : (
                  <span className="text-sm text-fg-muted">No link yet.</span>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <p className="text-ui">
        <Link href={`/dashboard/organization/${view.organization.id}/import`} className="link inline-flex min-h-11 items-center">
          Back to the import
        </Link>
      </p>
    </ToolPage>
  );
}
