// /dashboard/schools/[id] (milestone M11, In scope 2 and 3): one of the Sifu's schools. The listing
// at the top: its status, whether its pin is on the public map, the reviewers' question or reason,
// and the next step: "Send for review" (needs Professional Sifu; a Free Sifu sees <UpgradePrompt>
// instead, DEFAULT D08/D18), or "Confirm it is current" for a listed school (D17). The school form
// below (schools.update). Only the account that listed the school reaches it (404 otherwise).
// Reads the session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { OutcomeNote } from '@/components/relationships/parts';
import { LocationTag } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { mapStyles } from '@/server/geo/map-styles';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { requestPilotAccessAction } from '../../actions';
import { SCHOOL_ACTION_FORM, SCHOOL_FORM } from '../form-ids';
import { PIN_TEXT } from '../labels';
import { ListingAction } from '../listing-actions';
import { CitySearch, EditorShell } from '../parts';
import { SchoolForm } from '../school-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your school',
  robots: { index: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function SchoolEditorPage({ params, searchParams }: Props) {
  const { id } = await params;
  const page = `/dashboard/schools/${UUID.test(id) ? id : ''}`;
  const guard = await guardRoute(page);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const city = typeof query.city === 'string' ? query.city.trim().slice(0, 100) || null : null;
  const client = serverClient(await headers(), guard.principal);

  let missing = false;
  const editor = UUID.test(id)
    ? await pageRead(
        client.schools.edit({ id, city }).catch((error: unknown) => {
          if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') {
            missing = true;
            return null;
          }
          throw error;
        }),
      )
    : ((missing = true), null);
  if (missing || (editor && !editor.school)) {
    return (
      <EditorShell title="School not found" lead="This school is not one you listed, or the address is mistyped.">
        <p>
          <Link href="/dashboard/schools" className={buttonVariants({ variant: 'secondary' })}>
            Your schools
          </Link>
        </p>
      </EditorShell>
    );
  }
  if (!editor) return <LoadError {...LOAD_ERRORS.school} retryHref={page} />;
  const school = editor.school!;
  const [formOutcome, listingOutcome] = await Promise.all([readFormResult(SCHOOL_FORM, query.outcome), readFormResult(SCHOOL_ACTION_FORM, query.outcome)]);
  const one = (key: string) => (typeof query[key] === 'string' ? query[key] : null);
  const review = editor.review;
  const draft = school.status === 'draft';
  const needsInfo = school.status === 'pending_review' && review?.status === 'needs_info';

  return (
    <EditorShell title={school.name} lead={`${school.placeName}, ${school.countryCode} · ${school.statusLabel}`}>
      {one('saved') ? (
        <OutcomeNote testId="school-saved">
          {school.status === 'active' ? 'Saved. The school stays listed with the changes.' : 'Saved. The school is a draft that only you see until you send it for review.'}
        </OutcomeNote>
      ) : one('sent') ? (
        <OutcomeNote testId="school-sent">Sent for review. A moderator checks the listing; you get a notification when it is decided.</OutcomeNote>
      ) : one('confirmed') ? (
        <OutcomeNote testId="school-confirmed">Confirmed: the listing shows it was checked today.</OutcomeNote>
      ) : null}

      <section aria-labelledby="listing-heading" className="grid gap-3 rounded-sm border border-border-subtle p-4" data-testid="school-listing" data-status={school.status} data-pin={school.pin}>
        <h2 id="listing-heading" className="font-display text-xl">
          Listing
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-fg-muted">Status</dt>
          <dd data-testid="school-status">{school.statusLabel}</dd>
          <dt className="text-fg-muted">Map</dt>
          <dd data-testid="school-pin">{PIN_TEXT[school.pin]}</dd>
          <dt className="text-fg-muted">Location</dt>
          <dd>
            <LocationTag precision={school.locationPrivacy === 'exact' ? 'exact' : 'city'} />
          </dd>
          <dt className="text-fg-muted">Last activity</dt>
          <dd>{formatDay(school.lastActivityAt)}</dd>
          {review ? (
            <>
              <dt className="text-fg-muted">Review</dt>
              <dd data-testid="school-review">{review.statusLabel}</dd>
            </>
          ) : null}
        </dl>
        {review?.question ? (
          <p className="rounded-sm border-l-4 border-fg bg-surface-2 px-3 py-2 text-sm" data-testid="review-question">
            The reviewers ask: {review.question}
          </p>
        ) : null}
        {draft && review?.reason ? (
          <p className="rounded-sm border-l-4 border-fg bg-surface-2 px-3 py-2 text-sm" data-testid="review-reason">
            Returned to draft: {review.reason}
          </p>
        ) : null}

        {draft || needsInfo ? (
          editor.canSubmit ? (
            <ListingAction schoolId={school.id} step="submit" label={needsInfo ? 'Send the answer for review' : 'Send for review'} initial={listingOutcome} />
          ) : editor.upgrade ? (
            <UpgradePrompt
              offer={editor.upgrade}
              requestAction={requestPilotAccessAction}
              notNowAction={page}
              closedByChoice={query[UPGRADE_CLOSED_PARAM.name] === UPGRADE_CLOSED_PARAM.value}
              expanded={query[UPGRADE_OPEN_PARAM.name] === UPGRADE_OPEN_PARAM.value}
            />
          ) : (
            <p className="text-sm text-fg-muted">This account cannot send a school for review.</p>
          )
        ) : null}
        {school.status === 'active' ? <ListingAction schoolId={school.id} step="confirm" label="Confirm it is current" initial={listingOutcome} /> : null}
        {school.pin === 'shown' ? (
          <p>
            <Link href={`/schools/${school.slug}`} className="link inline-flex min-h-11 items-center" data-testid="public-school-link">
              Open the public page
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="details-heading" className="grid gap-6">
        <h2 id="details-heading" className="font-display text-xl">
          Details
        </h2>
        <CitySearch action={page} query={city} />
        <SchoolForm
          school={{
            id: school.id,
            name: school.name,
            placeId: school.placeId,
            locationPrivacy: school.locationPrivacy,
            point: school.point,
            websiteUrl: school.websiteUrl,
            contactEmail: school.contactEmail,
            contactPhone: school.contactPhone,
            description: school.description,
            formsTaught: school.formsTaught,
            instructorIds: school.instructorIds,
          }}
          places={editor.places}
          cityQuery={city}
          forms={editor.forms}
          instructorOptions={editor.instructorOptions}
          styles={mapStyles()}
          idempotencyKey={null}
          initial={formOutcome}
        />
      </section>
    </EditorShell>
  );
}
