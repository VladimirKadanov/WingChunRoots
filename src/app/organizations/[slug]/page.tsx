// /organizations/[slug] (milestone M15; plan §6.4, docs/adr/0018-organizations.md): an approved
// organization's public page, made from the public DTO only (organizations.get): its kind, country
// and website, the members who are public people (DEFAULT D03) and the public schools that
// accepted its link, by city only (never a point). It shows no plan, no admin and nothing from the
// application. An address that is not an approved organization, a malformed one included, shows
// the same "not listed" state, never indexed.
//
// DEFAULT D04: the page says that the approval is not a verification; DEFAULT D12: membership is
// not a teaching relationship.

import type { Metadata } from 'next';
import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { ArrowLeftIcon } from '@/components/icons';
import { PersonAvatar } from '@/components/lineage/person-avatar';
import { ErrorPanel } from '@/components/lineage/states';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { countryName } from '@/lib/regions';
import { appUrl } from '@/server/auth/env';
import { loadOrganization } from '../data';

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
  return (
    <article className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="organization-page" data-slug={org.slug}>
      <header className="max-w-[46rem]">
        <Back />
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{org.name}</h1>
        <p className="mt-3 text-fg-muted">
          {org.kindLabel}
          {country ? ` · ${country}` : ''}
        </p>
        <p className="mt-3 text-sm" data-testid="organization-approved">
          <span className="font-semibold">Approved organization</span>
          {org.approvedOn ? <span className="text-fg-muted"> · since {formatDay(org.approvedOn)}</span> : null}
        </p>
        <p className="mt-1 max-w-[60ch] text-sm text-fg-muted">
          The reviewers checked that the organization exists. That is not a verification of its members: who taught whom is confirmed by those people alone.
        </p>
        {org.websiteUrl ? (
          <p className="mt-3">
            <a href={org.websiteUrl} rel="noopener noreferrer nofollow" className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]" translate="no" data-testid="organization-website">
              {org.websiteUrl.replace(/^https?:\/\//, '')}
            </a>
          </p>
        ) : null}
      </header>

      <div className="mt-8 grid max-w-[46rem] gap-10">
        <section aria-labelledby="organization-members">
          <h2 id="organization-members" className="font-display text-xl">
            Members
          </h2>
          {org.members.length > 0 ? (
            <ul className="mt-3 grid gap-3">
              {org.members.map((member) => (
                <li key={member.slug} className="grid gap-1 border-b border-border-subtle pb-3" data-testid="organization-member" data-slug={member.slug}>
                  <p className="flex flex-wrap items-center gap-x-3 font-display text-lg">
                    <PersonAvatar name={member.displayName.value} photo={member.photo ?? null} size="sm" decorative />
                    <Link href={`/people/${member.slug}`} className="link inline-flex min-h-11 items-center">
                      <NameText name={member.displayName} />
                    </Link>
                    {member.original ? (
                      <span className="text-base text-fg-muted">
                        <NameText name={member.original} />
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-fg-muted">{member.roleLabel}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-fg-muted">No member with a public profile is listed.</p>
          )}
        </section>

        <section aria-labelledby="organization-schools">
          <h2 id="organization-schools" className="font-display text-xl">
            Schools
          </h2>
          {org.schools.length > 0 ? (
            <ul className="mt-3 grid gap-2">
              {org.schools.map((school) => (
                <li key={school.slug} data-testid="organization-school" data-slug={school.slug}>
                  <Link href={`/schools/${school.slug}`} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]">
                    {school.name}
                  </Link>
                  <span className="text-sm text-fg-muted">
                    {' '}
                    · {school.city}, {school.countryCode}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-fg-muted">No listed school has accepted a link yet.</p>
          )}
        </section>
      </div>
    </article>
  );
}
