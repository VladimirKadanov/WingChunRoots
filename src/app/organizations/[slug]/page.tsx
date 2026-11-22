// /organizations/[slug] (milestone M15; plan §6.4, docs/adr/0018-organizations.md): an approved
// organization's public page, made from the public DTO only (organizations.get): its kind, country
// and website, the members who are public people (DEFAULT D03) and the public schools that
// accepted its link, by city only (never a point). It shows no plan, no admin and nothing from the
// application. An address that is not an approved organization, a malformed one included, shows
// the same "not listed" state, never indexed.
//
// DEFAULT D04: the page says that the approval is not a verification; DEFAULT D12: membership is
// not a teaching relationship.
//
// ADR 0052: a banner (its own or the drawn motif of its kind), its logo or monogram, the numbers
// (public schools, public members, cities, upcoming events), its About, the schools and members as
// cards, its upcoming events, and the cities of its schools at their centres (never a point).

import type { Metadata } from 'next';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { UpcomingEvents } from '@/components/events/event-list';
import { ArrowLeftIcon } from '@/components/icons';
import { Banner, Emblem } from '@/components/ink/ink-art';
import { PersonAvatar } from '@/components/lineage/person-avatar';
import { ErrorPanel } from '@/components/lineage/states';
import { CityMap } from '@/components/organizations/city-map';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { organizationMotif } from '@/lib/ink-art';
import { countryName } from '@/lib/regions';
import { appUrl } from '@/server/auth/env';
import { loadOrganization, loadOrganizationEvents } from '../data';

export const instant = false;

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const read = await loadOrganization((await params).slug);
  if (read.state === 'none') return { title: 'Organization not listed', robots: { index: false, follow: false } };
  if (read.state === 'failed') return { title: 'Organization not loaded', robots: { index: false, follow: false } };
  const { organization: org } = read;
  const description = `${org.name}: a Wing Chun ${org.kindLabel.toLowerCase()}${org.countryCode ? ` in ${countryName(org.countryCode) ?? org.countryCode}` : ''}.`;
  return {
    metadataBase: new URL(appUrl()),
    title: org.name,
    description,
    alternates: { canonical: `/organizations/${org.slug}` },
    openGraph: { type: 'website', title: org.name, description, url: `/organizations/${org.slug}` },
  };
}

function Back() {
  return (
    <p className="eyebrow">
      <Link href="/organizations" className="link inline-flex min-h-11 items-center gap-1.5">
        <ArrowLeftIcon size={16} />
        Organizations
      </Link>
    </p>
  );
}

export default async function OrganizationPage({ params }: Props) {
  const { slug } = await params;
  const read = await loadOrganization(slug);
  if (read.state !== 'found') {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <Back />
        {read.state === 'none' ? (
          <div data-testid="organization-not-listed">
            <h1 className="mt-2 font-display text-feature">This organization is not listed</h1>
            <p className="mt-3 max-w-[56ch] text-fg-muted">The address may be mistyped, or the organization is not public. The list shows every approved organization.</p>
            <p className="mt-6">
              <Link href="/organizations" className={buttonVariants({ variant: 'secondary' })}>
                All organizations
              </Link>
            </p>
          </div>
        ) : (
          <ErrorPanel title="The organization could not be loaded." className="mt-6 max-w-[46rem]">
            <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
            <Link href={`/organizations/${encodeURIComponent(slug)}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Try again
            </Link>
          </ErrorPanel>
        )}
      </div>
    );
  }

  const { organization: org } = read;
  const country = org.countryCode ? (countryName(org.countryCode) ?? org.countryCode) : null;
  const events = await loadOrganizationEvents(org.slug);
  const stats = [
    { label: org.schoolCount === 1 ? 'school' : 'schools', value: org.schoolCount },
    { label: org.memberCount === 1 ? 'member' : 'members', value: org.memberCount },
    { label: org.cities.length === 1 ? 'city' : 'cities', value: org.cities.length },
    ...(events ? [{ label: events.total === 1 ? 'upcoming event' : 'upcoming events', value: events.total }] : []),
  ];
  return (
    <article className="pb-10 md:pb-14" data-testid="organization-page" data-slug={org.slug}>
      {/* ADR 0052: the organization's banner, or the drawn motif of its kind; decorative. */}
      <div className="relative h-40 border-b border-border-subtle sm:h-56 lg:h-72">
        <Banner image={org.banner} slug={org.slug} motif={organizationMotif(org.kind)} className="size-full" testId="organization-banner" />
        <div className="absolute top-3 left-4 sm:left-6 md:top-6 lg:left-10">
          <Link href="/organizations" className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border-strong bg-bg px-3.5 text-sm font-semibold hover:bg-surface-3">
            <ArrowLeftIcon size={16} />
            Organizations
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-content px-page">
        <header className="grid gap-3">
          <Emblem logo={org.logo} name={org.name} shape="shield" className="relative z-10 -mt-10 size-20 shadow-sm md:-mt-14 md:size-28" />
          <p className="text-label uppercase text-fg-muted">
            {org.kindLabel}
            {country ? ` · ${country}` : ''}
          </p>
          <h1 className="font-display text-feature [overflow-wrap:anywhere] md:text-hero">{org.name}</h1>
          <div className="grid max-w-[60ch] gap-1">
            <p className="text-sm" data-testid="organization-approved">
              <span className="font-semibold">Approved organization</span>
              {org.approvedOn ? <span className="text-fg-muted"> · since {formatDay(org.approvedOn)}</span> : null}
            </p>
            <p className="text-sm text-fg-muted">
              The reviewers checked that the organization exists. That is not a verification of its members: who taught whom is confirmed by those people alone.
            </p>
          </div>
          {org.websiteUrl ? (
            <p>
              <a href={org.websiteUrl} rel="noopener noreferrer nofollow" className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]" translate="no" data-testid="organization-website">
                {org.websiteUrl.replace(/^https?:\/\//, '')}
              </a>
            </p>
          ) : null}
          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-subtle bg-border-subtle sm:grid-cols-4" data-testid="organization-stats">
            {stats.map((stat) => (
              <div key={stat.label} className="flex flex-col-reverse gap-0.5 bg-surface-1 px-4 py-3">
                <dt className="text-sm text-fg-muted">{stat.label}</dt>
                <dd className="font-display text-2xl">{stat.value.toLocaleString('en')}</dd>
              </div>
            ))}
          </dl>
        </header>

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
          <div className="grid min-w-0 content-start gap-10">
            {org.about ? (
              <section aria-labelledby="organization-about" data-testid="organization-about">
                <h2 id="organization-about" className="font-display text-xl">
                  About
                </h2>
                <p className="mt-2 max-w-[65ch] whitespace-pre-line">{org.about}</p>
              </section>
            ) : null}

            <section aria-labelledby="organization-schools">
              <h2 id="organization-schools" className="font-display text-xl">
                Schools
              </h2>
              {org.schools.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {org.schools.map((school) => (
                    <li
                      key={school.slug}
                      className="relative flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-1 p-3 focus-within:border-fg hover:border-border-strong"
                      data-testid="organization-school"
                      data-slug={school.slug}
                    >
                      <Emblem logo={school.logo} name={school.name} shape="seal" className="size-12" />
                      <div className="min-w-0">
                        <Link
                          href={`/schools/${school.slug}`}
                          className="inline-flex min-h-11 items-center font-display text-lg leading-tight [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-['']"
                        >
                          {school.name}
                        </Link>
                        <p className="text-sm text-fg-muted">
                          {school.city}, {school.countryCode}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-fg-muted">No listed school has accepted a link yet.</p>
              )}
            </section>

            <section aria-labelledby="organization-members">
              <h2 id="organization-members" className="font-display text-xl">
                Members
              </h2>
              {org.members.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {org.members.map((member) => (
                    <li
                      key={member.slug}
                      className="relative flex items-center gap-3 rounded-sm border border-border-subtle bg-surface-1 p-3 focus-within:border-fg hover:border-border-strong"
                      data-testid="organization-member"
                      data-slug={member.slug}
                    >
                      <PersonAvatar name={member.displayName.value} photo={member.photo ?? null} size="sm" decorative />
                      <div className="min-w-0">
                        <Link
                          href={`/people/${member.slug}`}
                          className="inline-flex min-h-11 items-center font-display text-lg leading-tight [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-['']"
                        >
                          <NameText name={member.displayName} />
                        </Link>
                        {member.original ? (
                          <p className="text-sm text-fg-muted">
                            <NameText name={member.original} />
                          </p>
                        ) : null}
                        <p className="text-sm text-fg-muted">{member.roleLabel}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-fg-muted">No member with a public profile is listed.</p>
              )}
            </section>

            {events ? (
              <UpcomingEvents
                items={events.items}
                total={events.total}
                allHref={`/events?organization=${org.slug}`}
                emptyText="No upcoming event is listed."
              />
            ) : null}
          </div>

          <aside aria-labelledby="organization-where" className="grid content-start gap-3">
            <h2 id="organization-where" className="font-display text-xl">
              Where its schools are
            </h2>
            {org.cities.length > 0 ? (
              <CityMap cities={org.cities} />
            ) : (
              <p className="text-sm text-fg-muted">No listed school yet.</p>
            )}
            <p className="text-sm text-fg-muted">Each city at its centre. A school&apos;s own page says where it trains.</p>
          </aside>
        </div>
      </div>
    </article>
  );
}
