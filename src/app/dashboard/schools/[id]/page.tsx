// /dashboard/schools/[id] (milestone M11, In scope 2 and 3): one of the Sifu's schools. The listing
// at the top: its status, whether its pin is on the public map, the reviewers' question or reason,
// and the next step: "Send for review" (needs Professional Sifu; a Free Sifu sees <UpgradePrompt>
// instead, DEFAULT D08/D18), or "This listing is current" for a listed school (D17). M20: the
// activity check of a listed school (awaiting confirmation from day 90, hidden from the map from day
// 105, DEFAULT D17) with its mark, its words and its dates, and then the confirmation is the
// page's primary action; a Free Sifu is told that the confirmation is recorded and unlocks no pin
// (DEFAULT D18). Below, the
// school's details with "Edit the details" (./edit: the school form, schools.update): a page of its
// own, so neither page's first JavaScript carries both the form and the upgrade prompt (the route
// budget, ADR 0014). M21: the schedule and fees (./schedule), the trial lesson requests
// (./inquiries) and the weekly statistics (./stats, Professional Sifu), each on a page of its own.
// Only the account that listed the school reaches it (404 otherwise). Reads the
// session, so it renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { LoadError } from '@/components/account/load-error';
import { SCHOOL_LOAD_ERROR } from '@/components/account/load-errors/school';
import { PageRedirect } from '@/components/account/page-redirect';
import { UpgradePrompt } from '@/components/plans/upgrade-prompt';
import { UPGRADE_CLOSED_PARAM, UPGRADE_OPEN_PARAM } from '@/components/plans/form-ids';
import { OutcomeNote } from '@/components/relationships/parts';
import { ActivityState } from '@/components/schools/activity-state';
import { LocationTag } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { requestPilotAccessAction } from '../../actions';
import { SCHOOL_ACTION_FORM } from '../form-ids';
import { PIN_TEXT } from '../labels';
import { ListingAction } from '../listing-actions';
import { EditorShell, SchoolNotFound } from '../parts';

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
  const client = serverClient(await headers(), guard.principal);

  let missing = false;
  const editor = UUID.test(id)
    ? await pageRead(
        client.schools.edit({ id }).catch((error: unknown) => {
          if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') {
            missing = true;
            return null;
          }
          throw error;
        }),
      )
    : ((missing = true), null);
  if (missing || (editor && !editor.school)) return <SchoolNotFound />;
  if (!editor) return <LoadError {...SCHOOL_LOAD_ERROR} retryHref={page} />;
  const school = editor.school!;
  // M21: the schedule's summary and the open trial lesson requests; a failed read leaves the line out.
  const [schedule, inbox] = await Promise.all([
    client.schools.schedule({ id: school.id }).catch(() => null),
    client.trial.inbox({ schoolId: school.id, status: 'open' }).catch(() => null),
  ]);
  const listingOutcome = await readFormResult(SCHOOL_ACTION_FORM, query.outcome);
  const one = (key: string) => (typeof query[key] === 'string' ? query[key] : null);
  const review = editor.review;
  const draft = school.status === 'draft';
  const listed = school.status === 'active';
  const activity = school.activity;
  // A question on a new listing, or on a listed school's edit (schools.update reopens the review).
  const needsInfo = (school.status === 'pending_review' || school.status === 'active') && review?.status === 'needs_info';
  const editUnderReview = school.status === 'active' && (review?.status === 'open' || review?.status === 'in_review');
  const formLabel = new Map(editor.forms.map((f) => [f.key, f.label]));
  const instructorLabel = new Map(editor.instructorOptions.map((o) => [o.id, o.label]));
  const details: [string, string][] = [
    ['City', `${school.placeName}, ${school.countryCode}`],
    ['Pin', school.point ? `${school.point.lat}, ${school.point.lng}${school.locationPrivacy === 'city_only' ? ' (private)' : ''}` : 'None'],
    ['Website', school.websiteUrl ?? '—'],
    ['E-mail', school.contactEmail ?? '—'],
    ['Phone', school.contactPhone ?? '—'],
    ['Forms', school.formsTaught.map((key) => formLabel.get(key) ?? key).join(', ') || '—'],
    ['Instructors', ['You (head instructor)', ...school.instructorIds.map((personId) => instructorLabel.get(personId) ?? 'A confirmed student')].join(', ')],
  ];

  return (
    <EditorShell title={school.name} lead={`${school.placeName}, ${school.countryCode} · ${school.statusLabel}`}>
      {one('saved') ? (
        <OutcomeNote testId="school-saved">
          {school.status === 'active'
            ? editUnderReview
              ? 'Saved. The school stays listed with the changes, and a moderator checks them again.'
              : 'Saved. The school stays listed with the changes.'
            : school.status === 'pending_review'
              ? 'Saved. The reviewers see the changes with the listing.'
              : 'Saved. The school is a draft that only you see until you send it for review.'}
        </OutcomeNote>
      ) : one('sent') ? (
        <OutcomeNote testId="school-sent">Sent for review. A moderator checks the listing; you get a notification when it is decided.</OutcomeNote>
      ) : one('schedule') ? (
        <OutcomeNote testId="school-schedule-saved">
          {school.status === 'active' ? 'The schedule and fees are saved and shown on the public page.' : 'The schedule and fees are saved; the public page shows them once the school is listed.'}
        </OutcomeNote>
      ) : one('confirmed') ? (
        <OutcomeNote testId="school-confirmed">
          {school.pin === 'shown'
            ? 'Confirmed: the listing is current as of today, and its pin is on the public map.'
            : school.pin === 'needs_plan'
              ? 'Confirmed: the listing is current as of today. The confirmation is recorded; a public pin needs Professional Sifu.'
              : 'Confirmed: the listing is current as of today.'}
        </OutcomeNote>
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
          {listed ? (
            <>
              <dt className="text-fg-muted">Activity</dt>
              <dd data-testid="school-activity" data-activity={activity.stage}>
                <ActivityState stage={activity.stage}>
                  {activity.stage === 'hidden' && activity.hiddenAt
                    ? `Hidden from the map since ${formatDay(activity.hiddenAt)}`
                    : activity.stage === 'awaiting_confirmation' && activity.awaitingSince
                      ? `Awaiting confirmation since ${formatDay(activity.awaitingSince)}`
                      : `Current: last edited or confirmed ${formatDay(activity.lastActivityAt)}`}
                </ActivityState>
              </dd>
            </>
          ) : (
            <>
              <dt className="text-fg-muted">Last activity</dt>
              <dd>{formatDay(school.lastActivityAt)}</dd>
            </>
          )}
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
        {listed && activity.stage !== 'current' ? (
          <div className="grid gap-2 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-sm" data-testid="school-activity-note">
            <p className="max-w-[60ch]">
              {!editor.canSubmit
                ? `There has been no edit or confirmation since ${formatDay(activity.lastActivityAt)}. If the school still trains, confirm the listing or change its details. Nothing is deleted.`
                : activity.stage === 'hidden'
                ? `There has been no edit or confirmation since ${formatDay(activity.lastActivityAt)}, so the pin and the listing are not shown on the public map and list. Nothing is deleted. If the school still trains, confirm the listing or change its details to show it again.`
                : `There has been no edit or confirmation since ${formatDay(activity.lastActivityAt)}. If the school still trains, confirm the listing. Without a confirmation by about ${formatDay(activity.hiddenFrom ?? activity.lastActivityAt)}, it is no longer shown on the public map and list until you confirm it. Nothing is deleted.`}
            </p>
            {/* DEFAULT D18: a Free Sifu's confirmation is recorded and unlocks no pin. */}
            {!editor.canSubmit ? <p className="max-w-[60ch] text-fg-muted">Your confirmation is recorded either way. A public pin also needs Professional Sifu.</p> : null}
          </div>
        ) : null}
        {listed ? (
          <ListingAction schoolId={school.id} step="confirm" label="This listing is current" variant={activity.stage === 'current' ? 'secondary' : 'primary'} initial={listingOutcome} />
        ) : null}
        {school.pin === 'shown' ? (
          <p>
            <Link href={`/schools/${school.slug}`} className="link inline-flex min-h-11 items-center" data-testid="public-school-link">
              Open the public page
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="details-heading" className="grid gap-3" data-testid="school-details">
        <h2 id="details-heading" className="font-display text-xl">
          Details
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {details.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd>
            </div>
          ))}
        </dl>
        {school.description ? <p className="max-w-[60ch] text-ui whitespace-pre-line">{school.description}</p> : null}
        <p>
          <Link href={`${page}/edit`} className={buttonVariants({ variant: 'secondary' })} data-testid="edit-school">
            Edit the details
          </Link>
        </p>
      </section>

      {/* M21: the schedule and fees, the trial lesson requests and the statistics, each a page of its own. */}
      <section aria-labelledby="schedule-heading" className="grid gap-3" data-testid="school-schedule-section">
        <h2 id="schedule-heading" className="font-display text-xl">
          Schedule and fees
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted" data-testid="school-schedule-summary">
          {schedule
            ? `${schedule.slots.length === 0 ? 'No classes listed' : schedule.slots.length === 1 ? '1 weekly class' : `${schedule.slots.length} weekly classes`}${schedule.fees ? ', fees described' : ', no fees described'}${schedule.firstTrialFree ? ', the first trial lesson is free' : ''}. Shown on the public page; no plan is needed.`
            : 'Your weekly classes and fees, shown on the public page; no plan is needed.'}
        </p>
        <p>
          <Link href={`${page}/schedule`} className={buttonVariants({ variant: 'secondary' })} data-testid="school-schedule-link">
            Edit the schedule and fees
          </Link>
        </p>
      </section>

      <section aria-labelledby="trials-heading" className="grid gap-3" data-testid="school-trials-section">
        <h2 id="trials-heading" className="font-display text-xl">
          Trial lesson requests
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">
          {inbox
            ? inbox.counts.open === 0
              ? 'No request waits for an answer.'
              : inbox.counts.open === 1
                ? '1 request waits for an answer.'
                : `${inbox.counts.open} requests wait for an answer.`
            : 'People who ask for a trial lesson while the school is listed.'}
        </p>
        <p>
          <Link href={`${page}/inquiries`} className={buttonVariants({ variant: 'secondary' })} data-testid="school-trials-link">
            Trial lesson requests
          </Link>
        </p>
      </section>

      <section aria-labelledby="stats-heading" className="grid gap-3" data-testid="school-stats-section">
        <h2 id="stats-heading" className="font-display text-xl">
          Statistics
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">Weekly counts of page views, map opens, contact clicks and trial requests (Professional Sifu).</p>
        <p>
          <Link href={`${page}/stats`} className={buttonVariants({ variant: 'secondary' })} data-testid="school-stats-link">
            Statistics
          </Link>
        </p>
      </section>

      {/* M16: the logo and the room photos, on a page of their own (the route budget, as the form). */}
      <section aria-labelledby="photos-heading" className="grid gap-3" data-testid="school-photos-link-section">
        <h2 id="photos-heading" className="font-display text-xl">
          Logo and photos
        </h2>
        <p className="max-w-[60ch] text-sm text-fg-muted">The public page shows your school’s logo and up to 12 photos of its rooms once the school is listed.</p>
        <p>
          <Link href={`${page}/photos`} className={buttonVariants({ variant: 'secondary' })} data-testid="school-photos-link">
            Logo and photos
          </Link>
        </p>
      </section>
    </EditorShell>
  );
}
