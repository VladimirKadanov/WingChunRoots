// /dashboard/schools/[id] (milestone M11, In scope 2 and 3): one of the Sifu's schools. The listing
// at the top: its status, whether its pin is on the public map, the reviewers' question or reason,
// and the next step: "Send for review" (needs Professional Sifu; a Free Sifu sees <UpgradePrompt>
// instead, DEFAULT D08/D18), or "Confirm it is current" for a listed school (D17). Below, the
// school's details with "Edit the details" (./edit: the school form, schools.update): a page of its
// own, so neither page's first JavaScript carries both the form and the upgrade prompt (the route
// budget, ADR 0013). Only the account that listed the school reaches it (404 otherwise). Reads the
// session, so it renders per request.

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
  if (!editor) return <LoadError {...LOAD_ERRORS.school} retryHref={page} />;
  const school = editor.school!;
  const listingOutcome = await readFormResult(SCHOOL_ACTION_FORM, query.outcome);
  const one = (key: string) => (typeof query[key] === 'string' ? query[key] : null);
  const review = editor.review;
  const draft = school.status === 'draft';
  const needsInfo = school.status === 'pending_review' && review?.status === 'needs_info';
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
            ? 'Saved. The school stays listed with the changes.'
            : school.status === 'pending_review'
              ? 'Saved. The reviewers see the changes with the listing.'
              : 'Saved. The school is a draft that only you see until you send it for review.'}
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
    </EditorShell>
  );
}
