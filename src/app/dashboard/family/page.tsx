// /dashboard/family (owner decision 2026-11-18, docs/adr/0048-kung-fu-family.md): the account's
// kung fu family on one page, for Premium Student and Professional Sifu. Its teachers, the
// classmates under each of them (senior, junior or the same year, by when each began with that
// teacher), the cousins (students of the teachers' training brothers and sisters), an optional
// country filter (a GET form, no script), private follows and the people followed with their
// current rank. Everyone here is public on the lineage pages already; follows are never shown to
// anyone. Data from family.get and follows.list; follows through thin Server Actions and /api/rpc.
// Reads the session, so the page renders per request.

import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';

import { fieldClassName } from '@/components/account/fields';
import { LoadError } from '@/components/account/load-error';
import { PageRedirect } from '@/components/account/page-redirect';
import { buttonVariants } from '@/components/ui/button-variants';
import { messageId } from '@/lib/form-state';
import { countryName } from '@/lib/regions';
import { guardRoute } from '@/server/auth/web';
import { readFormResult } from '@/server/forms/flash';
import { pageRead } from '@/server/rpc/form';
import { serverClient } from '@/server/rpc/server';
import type { FamilyClassmate, FamilyPerson, Seniority } from '@/server/services/family';
import type { NameData } from '@/server/templates/email/types';
import { FollowForm } from './follow-form';
import { FAMILY_FOLLOW_FORM } from './form-ids';

export const instant = false;

export const metadata: Metadata = {
  title: 'Your kung fu family',
  robots: { index: false },
};

const PAGE = '/dashboard/family';
const COUNTRY = /^[A-Z]{2}$/;

type Search = Promise<Record<string, string | string[] | undefined>>;

const SENIORITY: Record<Exclude<Seniority, null>, string> = { senior: 'Senior', junior: 'Junior', same_year: 'Same year' };

function Name({ name }: { name: NameData }) {
  return (
    <span lang={name.lang} translate="no">
      {name.value}
    </span>
  );
}

function Tag({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border-strong px-2 py-0.5 text-xs font-semibold" data-testid={testId}>
      {children}
    </span>
  );
}

function PersonRow({ person, country, extra }: { person: FamilyPerson; country: string | null; extra?: React.ReactNode }) {
  const where = countryName(person.countryCode);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle py-3" data-testid="family-person">
      <div className="grid min-w-0 gap-1">
        <p className="font-display text-lg [overflow-wrap:anywhere]">
          <Link href={`/people/${person.slug}`} className="link inline-flex min-h-11 items-center">
            <Name name={person.name} />
          </Link>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          {extra}
          {person.isNew ? <Tag testId="family-new">New this week</Tag> : null}
          {where ? <span>{where}</span> : null}
          {person.followed ? <span data-testid="family-following">Following</span> : null}
        </p>
      </div>
      <FollowForm slug={person.slug} name={person.name.value} followed={person.followed} country={country} />
    </li>
  );
}

function classmateExtra(c: FamilyClassmate) {
  return (
    <>
      {c.seniority ? <Tag testId="family-seniority">{SENIORITY[c.seniority]}</Tag> : null}
      {c.startYear ? <span className="tabular">since {c.startYear}</span> : null}
    </>
  );
}

export default async function FamilyPage({ searchParams }: { searchParams: Search }) {
  const guard = await guardRoute(PAGE);
  if (guard.redirectTo) return <PageRedirect to={guard.redirectTo} />;
  if (guard.forbidden) return <PageRedirect to="/sign-in" />;
  const query = await searchParams;
  const wanted = typeof query.country === 'string' && COUNTRY.test(query.country) ? query.country : undefined;
  const client = serverClient(await headers(), guard.principal);
  const [family, follows] = await Promise.all([pageRead(client.family.get({ country: wanted })), pageRead(client.follows.list())]);
  if (!family || !follows) {
    return (
      <LoadError
        eyebrow="Learning"
        title="Your kung fu family"
        message="We couldn't load your family. Nothing was changed."
        retryHref={PAGE}
        back={{ href: '/dashboard', label: 'Back to your dashboard' }}
      />
    );
  }
  const outcome = await readFormResult(FAMILY_FOLLOW_FORM, query.outcome);
  const notice = query.followed === '1' ? 'Followed. Nobody else can see who you follow.' : query.unfollowed === '1' ? 'You no longer follow them.' : null;
  const country = family.country;
  const classmates = family.branches.reduce((n, b) => n + b.classmates.length, 0);
  const cousins = family.cousins.reduce((n, g) => n + g.cousins.length, 0);

  return (
    <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
      <div className="max-w-[46rem]">
        <p className="eyebrow">Learning</p>
        <h1 className="mt-2 font-display text-feature">Your kung fu family</h1>
        <p className="mt-3 max-w-[60ch] text-ui text-fg-muted">
          The people you share teachers with, as the public lineage shows them. Follow someone to hear of their new ranks in your weekly digest. Follows are private: nobody
          sees who you follow, not even the person.
        </p>
        {notice ? (
          <p role="status" className="mt-4 text-ui font-semibold" data-testid="family-notice">
            {notice}
          </p>
        ) : null}
        {outcome?.status === 'error' && outcome.message ? (
          <p id={messageId(FAMILY_FOLLOW_FORM)} role="alert" tabIndex={-1} className="mt-4 text-ui text-danger" data-testid="family-error">
            <span className="font-semibold">Not changed:</span> {outcome.message}
          </p>
        ) : null}

        {!family.allowed ? (
          <section aria-labelledby="family-plan" className="mt-8 grid gap-3" data-testid="family-not-included">
            <h2 id="family-plan" className="font-display text-2xl">
              Part of Premium Student
            </h2>
            <p className="max-w-[60ch] text-ui text-fg-muted">
              Your kung fu family page, private follows and the weekly digest are part of Premium Student and Professional Sifu. Your classmates are on the lineage pages on
              every plan.
              {family.follows > 0 ? ` The ${family.follows === 1 ? 'person' : `${family.follows} people`} you followed stay on your list; the digest is paused.` : ''}
            </p>
            <div>
              <Link href="/account/plan" className={buttonVariants({ variant: 'secondary' })}>
                See your plan
              </Link>
            </div>
          </section>
        ) : (
          <>
            {family.countries.length > 0 ? (
              <form method="get" action={PAGE} className="mt-8 flex flex-wrap items-end gap-3" data-testid="family-country-form">
                <div className="grid gap-1.5">
                  <label htmlFor="family-country" className="text-sm font-semibold">
                    Country
                  </label>
                  <select id="family-country" name="country" defaultValue={country ?? ''} className={fieldClassName} data-testid="family-country">
                    <option value="">All countries</option>
                    {family.countries.map((code) => (
                      <option key={code} value={code}>
                        {countryName(code)}
                      </option>
                    ))}
                  </select>
                </div>
                <button type="submit" className={buttonVariants({ variant: 'secondary' })}>
                  Show
                </button>
              </form>
            ) : null}

            <section aria-labelledby="family-classmates" className="mt-8 grid gap-3">
              <h2 id="family-classmates" className="font-display text-2xl">
                Classmates <span className="text-fg-muted tabular">· {classmates}</span>
              </h2>
              {family.branches.length === 0 ? (
                <p className="max-w-[60ch] text-ui text-fg-muted" data-testid="family-no-teachers">
                  Your family starts with your teachers. Once a teacher confirms you on <Link href="/dashboard/teachers" className="link">My teachers</Link>, their other
                  students show here.
                </p>
              ) : (
                family.branches.map((b) => (
                  <div key={b.teacher.slug} className="grid gap-1" data-testid="family-branch">
                    <h3 className="mt-2 font-display text-lg">
                      Students of <Name name={b.teacher.name} />
                    </h3>
                    <p className="text-sm text-fg-muted">
                      {b.ownStartYear ? `You began in ${b.ownStartYear}. Senior and junior compare the year each of you began.` : 'Add when you began on My teachers to see who is senior or junior.'}
                    </p>
                    {b.classmates.length === 0 ? (
                      <p className="text-ui text-fg-muted">{country ? 'No classmates in this country.' : 'No other public students yet.'}</p>
                    ) : (
                      <ul className="grid" aria-label={`Students of ${b.teacher.name.value}`}>
                        {b.classmates.map((c) => (
                          <PersonRow key={c.slug} person={c} country={country} extra={classmateExtra(c)} />
                        ))}
                      </ul>
                    )}
                  </div>
                ))
              )}
            </section>

            {family.branches.length > 0 ? (
              <section aria-labelledby="family-cousins" className="mt-10 grid gap-3">
                <h2 id="family-cousins" className="font-display text-2xl">
                  Cousins <span className="text-fg-muted tabular">· {cousins}</span>
                </h2>
                <p className="max-w-[60ch] text-sm text-fg-muted">The students of your teachers’ training brothers and sisters.</p>
                {family.cousins.length === 0 ? (
                  <p className="text-ui text-fg-muted" data-testid="family-no-cousins">
                    {country ? 'No cousins in this country.' : 'No cousins on the public lineage yet.'}
                  </p>
                ) : (
                  family.cousins.map((g) => (
                    <div key={g.teacher.slug} className="grid gap-1" data-testid="family-cousin-group">
                      <h3 className="mt-2 font-display text-lg">
                        Students of{' '}
                        <Link href={`/people/${g.teacher.slug}`} className="link">
                          <Name name={g.teacher.name} />
                        </Link>
                      </h3>
                      <p className="text-sm text-fg-muted">
                        Trained alongside <Name name={g.via.name} />.
                      </p>
                      <ul className="grid" aria-label={`Students of ${g.teacher.name.value}`}>
                        {g.cousins.map((c) => (
                          <PersonRow key={c.slug} person={c} country={country} />
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </section>
            ) : null}
          </>
        )}

        <section aria-labelledby="family-follows" className="mt-10 grid gap-3" data-testid="family-follows">
          <h2 id="family-follows" className="font-display text-2xl">
            People you follow{' '}
            <span className="text-fg-muted tabular">
              · {follows.people.length} of {follows.max}
            </span>
          </h2>
          {follows.people.length === 0 ? (
            <p className="text-ui text-fg-muted" data-testid="family-follows-none">
              You follow nobody yet.
            </p>
          ) : (
            <ul className="grid" aria-label="People you follow">
              {follows.people.map((f) => (
                <li key={f.slug} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle py-3" data-testid="family-followed">
                  <div className="grid min-w-0 gap-1">
                    <p className="font-display text-lg [overflow-wrap:anywhere]">
                      <Link href={`/people/${f.slug}`} className="link inline-flex min-h-11 items-center">
                        <Name name={f.name} />
                      </Link>
                    </p>
                    <p className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
                      {f.newRank ? <Tag testId="family-new-rank">New rank</Tag> : null}
                      <span>{f.rank ?? 'No rank shown'}</span>
                    </p>
                  </div>
                  <FollowForm slug={f.slug} name={f.name.value} followed country={country} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
