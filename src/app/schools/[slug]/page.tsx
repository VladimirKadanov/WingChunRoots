// /schools/[slug] (milestone M11, In scope 7 and 8; plan §5.3, §6.4): a school's public page. Its
// instructors link to their profile, their list view and the explorer; its contacts, the forms it
// teaches and its location (an exact pin, or only the city for a private club). The page, its
// JSON-LD and its Open Graph image (./opengraph-image.tsx) are made from the public DTO only
// (schools.get): a city-only school is at its city's centre and its JSON-LD has no coordinates.
//
// A missing address, a school that is not public (a draft, under review, or a pin whose Sifu no
// longer holds Professional Sifu) and a malformed slug all show the same "not listed" state,
// never indexed. A read that fails shows an error state with Retry (plan §5.6).

import type { Metadata } from 'next';
import Link from 'next/link';

import { ArrowLeftIcon } from '@/components/icons';
import { NameText } from '@/components/account/person-names';
import { ErrorPanel } from '@/components/lineage/states';
import { LocationTag } from '@/components/schools/school-list';
import { buttonVariants } from '@/components/ui/button-variants';
import { formatDay } from '@/lib/dates';
import { finderHref } from '@/lib/school-finder';
import { appUrl } from '@/server/auth/env';
import type { SchoolPageDto } from '@/server/dto/schools';
import { loadSchool, locationLine } from './data';

export const instant = false;

type Props = { params: Promise<{ slug: string }> };

const ROLE_LABELS: Record<SchoolPageDto['instructors'][number]['role'], string> = {
  head_instructor: 'Head instructor',
  instructor: 'Instructor',
  assistant: 'Assistant instructor',
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const read = await loadSchool((await params).slug);
  if (read.state === 'none') return { title: 'School not listed', robots: { index: false, follow: false } };
  if (read.state === 'failed') return { title: 'School not loaded', robots: { index: false, follow: false } };
  const { school } = read;
  const description = `${school.name}: a Wing Chun school in ${school.city}, ${school.countryCode}.`;
  return {
    metadataBase: new URL(appUrl()),
    title: school.name,
    description,
    alternates: { canonical: `/schools/${school.slug}` },
    openGraph: { type: 'website', title: school.name, description, url: `/schools/${school.slug}` },
  };
}

/** schema.org data of the school (JSON-LD), from the public DTO: coordinates only for an exact pin. */
function jsonLd(school: SchoolPageDto): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsActivityLocation',
    name: school.name,
    url: `${appUrl()}/schools/${school.slug}`,
    ...(school.description ? { description: school.description } : {}),
    address: { '@type': 'PostalAddress', addressLocality: school.city, addressCountry: school.countryCode },
    ...(school.precision === 'exact' ? { geo: { '@type': 'GeoCoordinates', latitude: school.point.lat, longitude: school.point.lng } } : {}),
    ...(school.websiteUrl ? { sameAs: [school.websiteUrl] } : {}),
    ...(school.contactEmail ? { email: school.contactEmail } : {}),
    ...(school.contactPhone ? { telephone: school.contactPhone } : {}),
  };
}

function Back() {
  return (
    <p className="eyebrow">
      <Link href="/schools" className="link inline-flex min-h-11 items-center gap-1.5">
        <ArrowLeftIcon size={16} />
        Schools
      </Link>
    </p>
  );
}

export default async function SchoolPage({ params }: Props) {
  const { slug } = await params;
  const read = await loadSchool(slug);
  if (read.state !== 'found') {
    return (
      <div className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14">
        <Back />
        {read.state === 'none' ? (
          <div data-testid="school-not-listed">
            <h1 className="mt-2 font-display text-feature">This school is not listed</h1>
            <p className="mt-3 max-w-[56ch] text-fg-muted">
              The address may be mistyped, or the school is not on the public map now. The school finder shows every listed school.
            </p>
            <p className="mt-6">
              <Link href="/schools" className={buttonVariants({ variant: 'secondary' })}>
                Find a school
              </Link>
            </p>
          </div>
        ) : (
          <ErrorPanel title="The school could not be loaded." className="mt-6 max-w-[46rem]">
            <p className="text-sm text-fg-muted">Nothing was changed. Try again in a moment.</p>
            <Link href={`/schools/${encodeURIComponent(slug)}`} className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Try again
            </Link>
          </ErrorPanel>
        )}
      </div>
    );
  }

  const { school } = read;
  const exact = school.precision === 'exact';
  // The map around the school's public point: its pin, or its city's centre.
  const mapHref = finderHref({ lat: school.point.lat, lng: school.point.lng, z: exact ? 14 : 10 });
  const contacts = [
    school.websiteUrl ? { label: 'Website', value: school.websiteUrl, href: school.websiteUrl, testid: 'school-website' } : null,
    school.contactEmail ? { label: 'E-mail', value: school.contactEmail, href: `mailto:${school.contactEmail}`, testid: 'school-email' } : null,
    school.contactPhone ? { label: 'Phone', value: school.contactPhone, href: `tel:${school.contactPhone.replace(/[^\d+]/g, '')}`, testid: 'school-phone' } : null,
  ].filter((c) => c !== null);

  return (
    <article className="mx-auto max-w-content px-page pt-6 pb-10 md:pt-11 md:pb-14" data-testid="school-page" data-precision={school.precision}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(school)).replace(/</g, '\\u003c') }} />
      <header className="max-w-[46rem]">
        <Back />
        <h1 className="mt-2 font-display text-feature [overflow-wrap:anywhere]">{school.name}</h1>
        <p className="mt-3 text-fg-muted">{locationLine(school)}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <LocationTag precision={school.precision} />
          <Link href={mapHref} className="link inline-flex min-h-11 items-center text-sm" data-testid="school-map-link">
            {exact ? 'Show on the map' : 'Show the city on the map'}
          </Link>
        </div>
        {!exact ? (
          <p className="mt-2 max-w-[56ch] text-sm text-fg-muted">
            A private club: its address is not public. The map shows it at the centre of {school.city}; ask the instructors for the address.
          </p>
        ) : null}
      </header>

      <div className="mt-8 grid max-w-[46rem] gap-10">
        {school.description ? (
          <section aria-labelledby="school-about">
            <h2 id="school-about" className="font-display text-xl">
              About
            </h2>
            <p className="mt-2 whitespace-pre-line">{school.description}</p>
          </section>
        ) : null}

        <section aria-labelledby="school-instructors">
          <h2 id="school-instructors" className="font-display text-xl">
            Instructors
          </h2>
          {school.instructors.length > 0 ? (
            <ul className="mt-3 grid gap-4">
              {school.instructors.map((instructor) => (
                <li key={instructor.id} className="grid gap-1 border-b border-border-subtle pb-4" data-testid="school-instructor" data-slug={instructor.slug}>
                  <p className="font-display text-lg">
                    <NameText name={instructor.displayName} />
                    {instructor.original ? (
                      <span className="ml-2 text-base text-fg-muted">
                        <NameText name={instructor.original} />
                      </span>
                    ) : null}
                  </p>
                  <p className="text-sm text-fg-muted">
                    {ROLE_LABELS[instructor.role]}
                    {instructor.lineages.length > 0 ? ` · ${instructor.lineages.map((l) => l.name).join(', ')}` : ''}
                  </p>
                  <p className="flex flex-wrap gap-x-5 text-sm">
                    <Link href={`/people/${instructor.slug}`} className="link inline-flex min-h-11 items-center" data-testid="instructor-profile">
                      Profile
                    </Link>
                    <Link href={`/people/${instructor.slug}/lineage`} className="link inline-flex min-h-11 items-center" data-testid="instructor-list">
                      Lineage as a list
                    </Link>
                    <Link href={`/explore?focus=${instructor.id}`} className="link inline-flex min-h-11 items-center" data-testid="instructor-explorer">
                      Open in the explorer
                    </Link>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-fg-muted">No instructor of this school has a public profile yet.</p>
          )}
        </section>

        {school.forms.length > 0 ? (
          <section aria-labelledby="school-forms">
            <h2 id="school-forms" className="font-display text-xl">
              Forms taught
            </h2>
            <ul className="mt-2 flex flex-wrap gap-2">
              {school.forms.map((form) => (
                <li key={form.key} className="rounded-sm border border-border-strong px-3 py-1 text-sm">
                  {form.label}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section aria-labelledby="school-contact">
          <h2 id="school-contact" className="font-display text-xl">
            Contact
          </h2>
          {contacts.length > 0 ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {contacts.map((c) => (
                <div key={c.label} className="contents">
                  <dt className="py-2.5 text-sm text-fg-muted">{c.label}</dt>
                  <dd className="min-w-0">
                    <a href={c.href} rel={c.label === 'Website' ? 'nofollow noopener' : undefined} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]" data-testid={c.testid}>
                      {c.value}
                    </a>
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-fg-muted">This school lists no contact yet. Its instructors&apos; profiles may help.</p>
          )}
        </section>

        <p className="border-t border-border-subtle pt-4 text-sm text-fg-muted">Listing last edited or confirmed on {formatDay(school.lastActivityOn)}.</p>
      </div>
    </article>
  );
}
