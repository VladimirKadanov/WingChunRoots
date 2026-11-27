// /dashboard/lineages/missing (journey review 2026-11-26, P2-2; docs/adr/0080-add-a-teacher.md):
// "My lineage is not listed" under the lineage list of the teacher form leads here. The member
// names the lineage; the archivists get a notification (lineage.reportMissing) and add it in the
// archive editor. Back to the form the member came from (`next`).

import type { Metadata } from 'next';
import Link from 'next/link';

import { PageRedirect } from '@/components/account/page-redirect';
import { ArrowLeftIcon } from '@/components/icons';
import { safeNextPath } from '@/server/auth/guards';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { MISSING_LINEAGE_FORM, missingLineagePage } from './form-ids';
import { MissingLineageForm } from './missing-lineage-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'My lineage is not listed',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

export default async function MissingLineagePage({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  const next = safeNextPath(query.next, '');
  const guard = await guardRoute('/dashboard/lineages/missing', missingLineagePage(next));
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const initial = await readFormResult(MISSING_LINEAGE_FORM, query.outcome);
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="grid max-w-[40rem] gap-6">
        {next ? (
          <p className="eyebrow">
            <Link href={next} className="link inline-flex min-h-11 items-center gap-1.5" data-testid="missing-lineage-back">
              <ArrowLeftIcon size={16} />
              Back to the form
            </Link>
          </p>
        ) : null}
        <h1 className="font-display text-feature">My lineage is not listed</h1>
        <p className="max-w-[60ch] text-fg-muted">
          The list holds the lineages the archive has recorded. Tell the archivists the name of yours: they add it when the record can hold it.
          Nothing else about you is sent.
        </p>
        <MissingLineageForm next={next} initial={initial} />
      </div>
    </div>
  );
}
