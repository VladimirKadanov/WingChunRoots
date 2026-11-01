// /dashboard/teachers/new (milestone M09, In scope 1; plan §5.6): a student names a teacher. The
// teacher comes from the search palette in select mode; the lineage, the training periods and
// the display wish (DEFAULT D05) follow. The request is sent through relationships.request (a thin
// Server Action, plan §6.8) and waits as pending_teacher, seen only by the two of them and the
// reviewers (DEFAULT D03).
//
// ?resubmit=<id> corrects a declined request and sends it again (relationships.resubmit): the form
// starts with the request as it was sent, under the teacher's neutral reason. ?teacher=<slug>
// starts the form with that teacher chosen: the results of the search form this page offers
// without JavaScript (?q=, inside <noscript>) lead there, since the palette needs JavaScript.
//
// Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { LOAD_ERRORS } from '@/components/account/load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { placeLine } from '@/lib/regions';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { RelationshipView } from '@/server/services/relationships';
import { REQUEST_FORM } from '../form-ids';
import { RequestForm } from './request-form';

export const instant = false;

export const metadata: Metadata = {
  title: 'Name a teacher',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/teachers/new';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,120}$/;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

/** A read that may answer 404 (a request that is not the account's, a profile that is not public): null then. */
async function orNotFound<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return null;
    throw error;
  }
}

/** The values of a declined request, as the form's fields name them. */
function resubmitValues(view: RelationshipView): Record<string, string> {
  const values: Record<string, string> = { lineageId: view.lineage.id, periodCount: String(Math.max(view.periods.length, 1)) };
  view.periods.forEach((period, i) => {
    const [fromYear, fromMonth] = (period.from ?? '').split('-');
    const [toYear, toMonth] = (period.to ?? '').split('-');
    if (fromYear) values[`periods.${i}.fromYear`] = fromYear;
    if (fromMonth) values[`periods.${i}.fromMonth`] = String(Number(fromMonth));
    if (toYear) values[`periods.${i}.toYear`] = toYear;
    if (toMonth) values[`periods.${i}.toMonth`] = String(Number(toMonth));
    if (period.ongoing) values[`periods.${i}.ongoing`] = 'on';
    if (period.school) values[`periods.${i}.schoolId`] = period.school.id;
  });
  if (view.prefersDisplayPrimary) values.displayPrimary = 'on';
  return values;
}

function Shell({ children, lead }: { children: ReactNode; lead: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/teachers" className="link inline-flex min-h-11 items-center">
            Your teachers
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Name a teacher</h1>
        <div className="mt-3 max-w-[60ch] text-ui text-fg-muted">{lead}</div>
        <div className="mt-8 grid gap-8">{children}</div>
      </div>
    </div>
  );
}

export default async function NewTeacherPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const resubmitId = UUID.test(one(query.resubmit)) ? one(query.resubmit) : null;
  const teacherSlug = !resubmitId && SLUG.test(one(query.teacher)) ? one(query.teacher) : null;
  const q = resubmitId ? '' : one(query.q).trim().slice(0, 100);
  const client = serverClient(await headers(), guard.principal);
  const retryHref = resubmitId ? `${PAGE}?resubmit=${resubmitId}` : PAGE;
  const loaded = await pageRead(
    Promise.all([
      client.relationships.options(),
      client.relationships.mine(),
      resubmitId ? orNotFound(client.relationships.get({ id: resubmitId })) : Promise.resolve(null),
      teacherSlug ? orNotFound(client.people.get({ slug: teacherSlug })) : Promise.resolve(null),
      q ? orNotFound(client.search.query({ q })) : Promise.resolve(null),
    ]),
  );
  if (!loaded) return <LoadError {...LOAD_ERRORS.newTeacher} retryHref={retryHref} />;
  const [options, mine, declined, chosen, found] = loaded;

  if (!mine.hasProfile) {
    return (
      <Shell lead="A teacher confirms you by your name, so your profile comes first.">
        <div data-testid="needs-profile" className="grid justify-items-start gap-3 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-4">
          <p className="text-ui">Your profile is not set up yet. Add your name, then come back to name your teacher.</p>
          <Link href={`/onboarding?next=${encodeURIComponent(PAGE)}`} className={buttonVariants({ variant: 'primary', size: 'lg' })}>
            Set up your profile
            <ArrowRightIcon />
          </Link>
        </div>
      </Shell>
    );
  }

  if (resubmitId && (!declined || !declined.can.resubmit)) {
    return (
      <Shell lead="Correct a declined request and send it again.">
        <div data-testid="resubmit-closed" className="grid justify-items-start gap-3 rounded-sm bg-surface-2 px-4 py-4">
          <p className="max-w-[56ch] text-ui text-fg-muted">
            This request can&apos;t be sent again: it was answered, withdrawn or sent again already, or it isn&apos;t yours. Your requests and their
            state are on Your teachers.
          </p>
          <Link href="/dashboard/teachers#requests" className={buttonVariants({ variant: 'secondary' })}>
            Your teachers
            <ArrowRightIcon />
          </Link>
        </div>
      </Shell>
    );
  }

  const initial = await readFormResult(REQUEST_FORM, query.outcome);
  const formOptions = {
    lineages: options.lineages.map((lineage) => ({ id: lineage.id, name: lineage.name })),
    schools: options.schools,
    earliestYear: options.earliestYear,
    maxPeriods: options.maxPeriods,
  };
  // A new key for every page: a refused submit keeps it (nothing was recorded under it), a sent one
  // replays (plan §5.6).
  const idempotencyKey = randomUUID();

  if (declined) {
    return (
      <Shell lead="Correct the request and send it again. The teacher sees it as a new request.">
        <div data-testid="rejection-reason" className="grid gap-1 rounded-sm border-l-4 border-fg bg-surface-2 px-4 py-3 text-ui">
          <p className="font-semibold">
            <NameText name={declined.teacher.name} /> declined the request
          </p>
          <p>{declined.rejection?.text ?? 'Some details need correcting. Check the request and send it again.'}</p>
        </div>
        <RequestForm
          options={formOptions}
          relationshipId={declined.id}
          fixedTeacher={{ name: declined.teacher.name.value, lang: declined.teacher.name.lang, where: declined.lineage.name }}
          prefill={resubmitValues(declined)}
          idempotencyKey={idempotencyKey}
          initial={initial}
        />
      </Shell>
    );
  }

  const prefill: Record<string, string> =
    chosen && !chosen.isOwn
      ? {
          teacherId: chosen.id,
          teacherName: chosen.displayName,
          teacherLang: 'und-Latn',
          teacherWhere: placeLine({ city: chosen.cityName, countryCode: chosen.countryCode, lineage: chosen.lineages[0]?.name }),
          // No confirmed link, no lineage of their own: the form asks for one (M09 review, screens-7).
          teacherHasLineage: chosen.lineages.length > 0 ? 'yes' : 'no',
        }
      : {};

  return (
    <Shell
      lead={
        <>
          Ask a teacher to confirm that they taught you. Each teacher answers their own request; one teacher&apos;s answer never confirms another. For a
          teacher who has died, reviewers confirm the training from your evidence:{' '}
          <Link href="/dashboard/teachers/historical" className="link">
            name a historical teacher
          </Link>
          . A living teacher who is not on WingChunRoots yet:{' '}
          <Link href="/dashboard/teachers/invite" className="link">
            invite your teacher
          </Link>
          .
        </>
      }
    >
      <noscript>
        <form method="get" action={PAGE} role="search" className="grid gap-3 rounded-sm border border-border-subtle p-4">
          <label htmlFor="find-teacher" className="text-sm font-semibold">
            Your teacher&apos;s name
          </label>
          <input
            id="find-teacher"
            name="q"
            defaultValue={q}
            autoComplete="off"
            maxLength={100}
            className="block min-h-12 w-full rounded-sm border border-border-strong bg-surface-1 px-4 text-field text-fg"
          />
          <div>
            <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
              Search
            </button>
          </div>
          {found ? (
            found.people.length === 0 ? (
              <p className="text-sm text-fg-muted">No public profile matches that name.</p>
            ) : (
              <ul className="grid gap-1">
                {found.people.map((hit) => (
                  <li key={hit.id}>
                    <a href={`${PAGE}?teacher=${encodeURIComponent(hit.slug)}`} className="link inline-flex min-h-11 items-center gap-2">
                      <NameText name={hit.displayName} />
                      <span className="text-sm text-fg-muted">{placeLine({ city: hit.city, countryCode: hit.countryCode, lineage: hit.lineageName })}</span>
                    </a>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </form>
      </noscript>
      <RequestForm options={formOptions} prefill={prefill} idempotencyKey={idempotencyKey} initial={initial} />
    </Shell>
  );
}
