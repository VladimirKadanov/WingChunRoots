// /dashboard/schools/[id]/schedule (M21, docs/adr/0024-trial-lessons.md): the weekly schedule and the
// fees of one of the account's schools (schools.schedule, schools.updateSchedule through a thin
// Server Action). The rows of the schedule, then three empty rows for new classes, at most 30 in
// all. A save goes back to the school's page (?schedule=1). Only the account that listed the school
// reaches it. Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { SCHEDULE_LOAD_ERROR } from '@/components/account/load-errors/trial-lessons';
import { PageRedirect } from '@/components/account/page-redirect';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageReadOne } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { SCHEDULE_FORM } from '../../form-ids';
import { EditorShell, SchoolNotFound } from '../../parts';
import { type ScheduleRow, ScheduleForm } from './schedule-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Schedule and fees',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLANK_ROWS = 3;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SchedulePage({ params, searchParams }: Props) {
  const { id } = await params;
  const valid = UUID.test(id);
  const page = `/dashboard/schools/${valid ? id : ''}`;
  const guard = await guardRoute(valid ? `${page}/schedule` : page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  if (!valid) return <SchoolNotFound />;
  const { missing, value: view } = await pageReadOne(serverClient(await headers(), guard.principal) .schools.schedule({ id }));
  if (missing) return <SchoolNotFound />;
  if (!view) return <LoadError {...SCHEDULE_LOAD_ERROR} retryHref={`${page}/schedule`} />;
  const outcome = await readFormResult(SCHEDULE_FORM, (await searchParams).outcome);
  // After a refused save, as many rows as were sent; otherwise the classes and three empty rows.
  const sent = Number.parseInt(outcome?.values?.rows ?? '', 10);
  const count = Math.min(view.limits.slots, Number.isFinite(sent) && sent > 0 ? sent : view.slots.length + BLANK_ROWS);
  const rows: ScheduleRow[] = Array.from({ length: count }, (_, i) => {
    // A refused save shows what was sent (its values), never the saved rows under it.
    const slot = outcome ? undefined : view.slots[i];
    return slot ? { weekday: String(slot.weekday), startsAt: slot.startsAt, endsAt: slot.endsAt, label: slot.label ?? '' } : { weekday: '', startsAt: '', endsAt: '', label: '' };
  });
  const editable = view.status === 'draft' || view.status === 'pending_review' || view.status === 'active';

  return (
    <EditorShell
      title={`Schedule and fees of ${view.name}`}
      lead={
        <>
          Shown on the school&apos;s public page while it is listed. No plan is needed.{' '}
          <Link href={page} className="link inline-flex min-h-11 items-center">
            Back to the listing
          </Link>
        </>
      }
    >
      {editable ? (
        <ScheduleForm
          school={{ id: view.id, name: view.name }}
          rows={rows}
          fees={outcome ? null : view.fees}
          firstTrialFree={view.firstTrialFree}
          timezone={view.timezone}
          limits={view.limits}
          initial={outcome}
        />
      ) : (
        <p className="text-ui text-fg-muted" data-testid="schedule-locked">
          A moderator hid this school or it is archived, so its schedule cannot be edited.
        </p>
      )}
    </EditorShell>
  );
}
