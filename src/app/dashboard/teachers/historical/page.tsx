// /dashboard/teachers/historical (milestone M10a, In scope 1 and 2; plan §5.6, §6.7): a student
// claims training with a historical or deceased teacher, with evidence. The review committee
// confirms it (relationships.requestHistorical → under_review, a review_case of kind
// historical_claim); until then the claim, and a teacher record it creates, are seen only by the
// student and the reviewers (DEFAULT D03).
//
// A teacher already on record is found with the search form on this page (a plain GET form, ?q=,
// that works without JavaScript and in a webview) and chosen through the address
// (?teacher=<slug>): only a public historical or deceased record can be chosen. Otherwise the form
// creates a new record from the name the student enters.
//
// Reads the session, so the page renders per request.

import { randomUUID } from 'node:crypto';

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { LoadError } from '@/components/account/load-error';
import { REVIEW_LOAD_ERRORS } from '@/components/account/review-load-error-text';
import { PageRedirect } from '@/components/account/page-redirect';
import { NameText } from '@/components/account/person-names';
import { ArrowRightIcon } from '@/components/icons';
import { buttonVariants } from '@/components/ui/button-variants';
import { placeLine } from '@/lib/regions';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead, rpcErrorCode } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import { ClaimForm, type FixedTeacher } from './claim-form';
import { HISTORICAL_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Name a historical teacher',
  robots: { index: false },
};

type Search = Promise<Record<string, string | string[] | undefined>>;

const PAGE = '/dashboard/teachers/historical';
const SLUG = /^[a-z0-9-]{1,120}$/;
/** The longest note a claim takes (historical.ts CLAIM_NOTE_MAX). */
const NOTE_MAX = 2000;

const one = (value: string | string[] | undefined) => (typeof value === 'string' ? value : '');

async function orNotFound<T>(read: Promise<T>): Promise<T | null> {
  try {
    return await read;
  } catch (error) {
    if (rpcErrorCode(error) === 'NOT_FOUND' || rpcErrorCode(error) === 'BAD_REQUEST') return null;
    throw error;
  }
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">
          <Link href="/dashboard/teachers" className="link inline-flex min-h-11 items-center">
            Your teachers
          </Link>
        </p>
        <h1 className="mt-2 font-display text-feature">Name a historical teacher</h1>
        <div className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          For a teacher who has died, or who can no longer confirm your training. Reviewers check your evidence and confirm the link; a living teacher
          with an account confirms their own requests on{' '}
          <Link href="/dashboard/teachers/new" className="link">
            Name a teacher
          </Link>
          .
        </div>
        <div className="mt-8 grid gap-8">{children}</div>
      </div>
    </div>
  );
}

export default async function HistoricalTeacherPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const slug = SLUG.test(one(query.teacher)) ? one(query.teacher) : null;
  const q = one(query.q).trim().slice(0, 100);
  const client = serverClient(await headers(), guard.principal);
  const loaded = await pageRead(
    Promise.all([
      client.relationships.options(),
      client.relationships.mine(),
      client.account.onboardingOptions(),
      slug ? orNotFound(client.people.get({ slug })) : Promise.resolve(null),
      q ? orNotFound(client.search.query({ q })) : Promise.resolve(null),
    ]),
  );
  if (!loaded) return <LoadError {...REVIEW_LOAD_ERRORS.historicalTeacher} retryHref={PAGE} />;
  const [options, mine, onboarding, chosen, found] = loaded;

  if (!mine.hasProfile) {
    return (
      <Shell>
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

  // Only a public historical or deceased record is chosen; anything else is ignored (the form then
  // creates a new record), with a note.
  const eligible = chosen && !chosen.isOwn && !chosen.limited && chosen.visibility === 'public' && (chosen.kind === 'historical' || chosen.lifeStatus === 'deceased');
  const teacher: FixedTeacher | null = eligible
    ? { id: chosen.id, slug: chosen.slug, name: chosen.displayName, where: placeLine({ city: chosen.cityName, countryCode: chosen.countryCode, lineage: chosen.lineages[0]?.name }) }
    : null;
  const initial = await readFormResult(HISTORICAL_FORM, query.outcome);

  return (
    <Shell>
      {/* A long word ("WingChunRoots?") may break, so with text at 200 % on a phone the box keeps
          to the screen (M10a review, screens-7; WCAG 1.4.10). */}
      <section aria-labelledby="find-on-record" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-sm border border-border-subtle p-4">
        <h2 id="find-on-record" className="font-display text-xl [overflow-wrap:anywhere]">
          Is the teacher already on WingChunRoots?
        </h2>
        <form method="get" action={PAGE} role="search" className="grid gap-3">
          <label htmlFor="find-teacher" className="text-sm font-semibold">
            Teacher&apos;s name, in any spelling
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
        </form>
        {found ? (
          found.people.length === 0 ? (
            <p className="text-sm text-fg-muted" data-testid="no-record-found">
              No public profile matches that name. Enter the teacher below: a new record is created with your claim.
            </p>
          ) : (
            <ul className="grid gap-1" data-testid="record-results">
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
        {slug && !teacher ? (
          <p className="text-sm text-fg-muted" data-testid="not-historical">
            That profile is not a historical record. A living teacher confirms requests themselves on{' '}
            <Link href="/dashboard/teachers/new" className="link">
              Name a teacher
            </Link>
            .
          </p>
        ) : null}
        {teacher ? (
          <p className="text-sm">
            <Link href={PAGE} className="link inline-flex min-h-11 items-center">
              Enter a teacher who is not on record instead
            </Link>
          </p>
        ) : null}
      </section>
      <ClaimForm
        options={{ lineages: options.lineages.map((l) => ({ id: l.id, name: l.name })), scripts: onboarding.scripts, noteMax: NOTE_MAX }}
        teacher={teacher}
        // A new key for every page: a refused submit keeps it (nothing was recorded), a sent one replays (plan §5.6).
        idempotencyKey={randomUUID()}
        initial={initial}
      />
    </Shell>
  );
}
