// /schools/[slug] (milestone M11, In scope 7 and 8; plan §5.3, §6.4): a school's public page. Its
// instructors link to their profile, their list view and the explorer; its contacts, the forms it
// teaches and its location (an exact pin, or only the city for a private club). The page, its
// JSON-LD and its Open Graph image (./opengraph-image.tsx) are made from the public DTO only
// (schools.get): a city-only school is at its city's centre and its JSON-LD has no coordinates.
//
// A missing address, a school that is not public (a draft, under review, or a pin whose Sifu no
// longer holds Professional Sifu) and a malformed slug all show the same "not listed" state,
// never indexed. A read that fails shows an error state with Retry (plan §5.6).
//
// M21 (docs/adr/0024-trial-lessons.md): the schedule and fees, the trial lesson action (trial.options:
// a request, a sign-in link that comes back here, or why not), and the stats beacon (a page view,
// a click on a contact; src/components/schools/school-beacon.tsx).

import type { Metadata } from 'next';
import Link from 'next/link';

import { UpcomingEvents } from '@/components/events/event-list';
import { GalleryGrid } from '@/components/gallery/gallery-grid';
import { ArrowLeftIcon } from '@/components/icons';
import { Banner, Emblem } from '@/components/ink/ink-art';
import { LOGO_GROUND } from '@/components/ink/logo-ground';
import { NameText } from '@/components/account/person-names';
import { PersonAvatar } from '@/components/lineage/person-avatar';
import { ErrorPanel } from '@/components/lineage/states';
import { SchoolBeacon } from '@/components/schools/school-beacon';
import { LocationTag } from '@/components/schools/school-list';
import { ScheduleAndFees, TrialAction } from '@/components/schools/school-schedule';
import { buttonVariants } from '@/components/ui/button-variants';
import { cx } from '@/lib/cx';
import { formatDay } from '@/lib/dates';
import { schoolMotif } from '@/lib/ink-art';
import { finderHref, SCHOOL_ZOOM } from '@/lib/school-finder';
import { appUrl } from '@/server/auth/env';
import type { SchoolPageDto } from '@/server/dto/schools';
import { loadSchool, loadSchoolEvents, loadTrialOptions } from './data';

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
  const [events, trial] = await Promise.all([loadSchoolEvents(school.slug), loadTrialOptions(school.slug)]);
  const exact = school.precision === 'exact';
  // The map around the school's public point: its pin, or its city's centre.
  const mapHref = finderHref({ lat: school.point.lat, lng: school.point.lng, z: exact ? SCHOOL_ZOOM.exact : SCHOOL_ZOOM.city });
  const contacts = [
    school.websiteUrl ? { label: 'Website', value: school.websiteUrl, href: school.websiteUrl, testid: 'school-website' } : null,
    school.contactEmail ? { label: 'E-mail', value: school.contactEmail, href: `mailto:${school.contactEmail}`, testid: 'school-email' } : null,
    school.contactPhone ? { label: 'Phone', value: school.contactPhone, href: `tel:${school.contactPhone.replace(/[^\d+]/g, '')}`, testid: 'school-phone' } : null,
  ].filter((c) => c !== null);
  const stats = [
    { label: school.instructors.length === 1 ? 'instructor' : 'instructors', value: school.instructors.length },
    { label: school.memberCount === 1 ? 'listed member' : 'listed members', value: school.memberCount },
    { label: school.schedule.length === 1 ? 'class a week' : 'classes a week', value: school.schedule.length },
    { label: school.forms.length === 1 ? 'form taught' : 'forms taught', value: school.forms.length },
    // Phone review 2026-11 (ADR 0053): a number that is zero says nothing worth the room.
  ].filter((stat) => stat.value > 0);
  const statColumns = ['', 'sm:grid-cols-1', 'sm:grid-cols-2', 'sm:grid-cols-3', 'sm:grid-cols-4'][stats.length];

  return (
    <article className="pb-10 md:pb-14" data-testid="school-page" data-precision={school.precision}>
      <SchoolBeacon schoolId={school.id} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(school)).replace(/</g, '\\u003c') }} />
      {/* ADR 0052: the school's banner, or the drawn motif of its slug; decorative. */}
      <div className={cx('relative border-b border-border-subtle sm:h-56 lg:h-72', school.banner ? 'h-40' : 'h-28')}>
        <Banner image={school.banner} slug={school.slug} motif={schoolMotif(school.slug)} className="size-full" testId="school-banner" />
        <div className="absolute top-3 left-4 sm:left-6 md:top-6 lg:left-10">
          <Link href="/schools" className="inline-flex min-h-11 items-center gap-1.5 rounded-sm border border-border-strong bg-bg px-3.5 text-sm font-semibold hover:bg-surface-3">
            <ArrowLeftIcon size={16} />
            Schools
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-content px-page">
      <header className="grid gap-3">
        {/* M16: the school's logo, whole on its transparent square, or (ADR 0052) its monogram seal;
            the heading names the school, so it is decorative. */}
        {school.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={school.logo.large}
            alt=""
            width={112}
            height={112}
            data-testid="school-logo"
            style={LOGO_GROUND}
            className="relative z-10 -mt-10 size-20 shrink-0 rounded-sm border border-border-strong bg-bg object-contain shadow-sm md:-mt-14 md:size-28"
          />
        ) : (
          <Emblem logo={null} name={school.name} shape="seal" className="relative z-10 -mt-10 size-20 shadow-sm md:-mt-14 md:size-28" />
        )}
        <h1 className="min-w-0 font-display text-feature [overflow-wrap:anywhere] md:text-hero">{school.name}</h1>
        {/* The location tag below says how precise it is (phone review 2026-11: not twice). */}
        <p className="text-fg-muted">
          {school.city}, {school.countryCode}
        </p>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <LocationTag precision={school.precision} />
          <Link href={mapHref} className="link inline-flex min-h-11 items-center text-sm" data-testid="school-map-link">
            {exact ? 'Show on the map' : 'Show the city on the map'}
          </Link>
        </div>
        {/* ADR 0051: the approved organizations whose link the school accepted. A link names a
            membership; it verifies no teacher or relationship (DEFAULT D04). */}
        {school.organizations.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-fg-muted" data-testid="school-member-of">
            <span>Member of</span>
            {school.organizations.map((org, i) => (
              <span key={org.slug} className="inline-flex items-center">
                <Link href={`/organizations/${org.slug}`} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]" data-testid="school-organization">
                  {org.name}
                </Link>
                <span className="ml-1">
                  ({org.kindLabel.toLowerCase()}){i < school.organizations.length - 1 ? ',' : ''}
                </span>
              </span>
            ))}
          </p>
        ) : null}
        {!exact ? (
          <p className="max-w-[56ch] text-sm text-fg-muted">
            A private club: its address is not public. The map shows it at the centre of {school.city}; ask the instructors for the address.
          </p>
        ) : null}
        {/* ADR 0052: on a phone the trial lesson and the contact are at the end of the page; these
            jump there. From 1024 px they sit beside the page. */}
        <nav aria-label="On this page" className="flex flex-wrap gap-2 lg:hidden" data-testid="school-quick-actions">
          <a href="#school-trial" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Trial lesson
          </a>
          <a href="#school-contact" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
            Contact
          </a>
          {school.schedule.length > 0 ? (
            <a href="#school-schedule" className={buttonVariants({ variant: 'secondary', size: 'sm' })}>
              Timetable
            </a>
          ) : null}
        </nav>
        {/* ADR 0052: the school at a glance; each number in words. */}
        {stats.length > 0 ? (
        <dl
          className={cx(
            'mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border-subtle bg-border-subtle [&>*:last-child:nth-child(odd)]:col-span-2 sm:[&>*:last-child:nth-child(odd)]:col-span-1',
            statColumns,
          )}
          data-testid="school-stats"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse gap-0.5 bg-surface-1 px-4 py-3">
              <dt className="text-sm text-fg-muted">{stat.label}</dt>
              <dd className="font-display text-2xl">{stat.value}</dd>
            </div>
          ))}
        </dl>
        ) : null}
      </header>

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-12">
      <div className="grid min-w-0 content-start gap-10">
        {/* M16: the photos of the school's rooms, a gallery of their own (every rendition without
            metadata, so no photo says where it was taken). */}
        {school.photos.length > 0 ? (
          <section aria-labelledby="school-photos" data-testid="school-gallery">
            <h2 id="school-photos" className="font-display text-xl">
              Photos
            </h2>
            <div className="mt-3">
              <GalleryGrid photos={school.photos} name={school.name} label={`Photos of ${school.name}`} testId="school-gallery-grid" />
            </div>
          </section>
        ) : null}
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
                  <p className="flex flex-wrap items-center gap-x-3 font-display text-lg">
                    {/* M14: the instructor's photo, or the monogram. */}
                    <PersonAvatar name={instructor.displayName.value} photo={instructor.photo} size="sm" decorative />
                    <NameText name={instructor.displayName} />
                    {instructor.original ? (
                      <span className="text-base text-fg-muted">
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
            <div className="mt-2 grid gap-1" data-testid="school-no-instructors">
              <p className="text-fg-muted">No instructor of this school has a public profile yet.</p>
              <p className="text-sm text-fg-muted">
                {contacts.length > 0 ? (
                  <>
                    To ask who teaches here,{' '}
                    <a href="#school-contact" className="link inline-flex min-h-11 items-center">
                      contact the school
                    </a>
                    .{' '}
                  </>
                ) : null}
                Teach here? The head instructor lists instructors from the students they confirmed.
              </p>
            </div>
          )}
        </section>

        <SchoolMembers school={school} />

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

        <ScheduleAndFees school={school} />

        {/* M17: the school's upcoming events (an event names a school its organizer chose). */}
        {events && events.items.length > 0 ? <UpcomingEvents items={events.items} total={events.total} allHref={`/events?school=${school.slug}`} /> : null}

        <p className="border-t border-border-subtle pt-4 text-sm text-fg-muted">Listing last edited or confirmed on {formatDay(school.lastActivityOn)}.</p>
      </div>
      {/* ADR 0052: what a visitor acts on, beside the page from 1024 px (under the header before). */}
      <aside aria-label="Visit the school" className="grid content-start gap-8 lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1">
        <div className="grid gap-8 rounded-md border border-border-subtle bg-surface-1 p-5">
          <TrialAction slug={school.slug} options={trial} />
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
                      <a href={c.href} rel={c.label === 'Website' ? 'nofollow noopener' : undefined} className="link inline-flex min-h-11 items-center [overflow-wrap:anywhere]" data-testid={c.testid} data-school-contact>
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
        </div>
      </aside>
      </div>
      </div>
    </article>
  );
}

/**
 * ADR 0044: the members who chose to be listed on their school's page (and are public). The plans
 * with the fuller listing show the photo and the current rank; every other member shows by name.
 * Left out while nobody is listed. Server-rendered: no client JavaScript.
 */
function SchoolMembers({ school }: { school: SchoolPageDto }) {
  if (school.members.length === 0) return null;
  const full = school.members.filter((m) => m.full);
  const names = school.members.filter((m) => !m.full);
  const count = school.memberCount;
  return (
    <section aria-labelledby="school-members" data-testid="school-members">
      <h2 id="school-members" className="font-display text-xl">
        Members
      </h2>
      <p className="mt-1 text-sm text-fg-muted">
        {count === 1 ? '1 member has' : `${count.toLocaleString('en')} members have`} chosen to be listed here.
      </p>
      {full.length > 0 ? (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {full.map((member) => (
            <li key={member.slug} className="flex items-center gap-3 rounded-sm border border-border-subtle p-3" data-testid="school-member" data-slug={member.slug} data-full="true">
              <PersonAvatar name={member.displayName.value} photo={member.photo} size="sm" decorative />
              <div className="min-w-0">
                <Link href={`/people/${member.slug}`} className="link inline-flex min-h-11 items-center font-display text-lg [overflow-wrap:anywhere]">
                  <NameText name={member.displayName} />
                </Link>
                {member.original ? (
                  <p className="text-sm text-fg-muted">
                    <NameText name={member.original} />
                  </p>
                ) : null}
                <p className="text-sm text-fg-muted">{member.rank ?? 'Member'}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {names.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-x-5" aria-label={full.length > 0 ? 'More members' : 'Members'}>
          {names.map((member) => (
            <li key={member.slug} data-testid="school-member" data-slug={member.slug} data-full="false">
              <Link href={`/people/${member.slug}`} className="link inline-flex min-h-11 items-center">
                <NameText name={member.displayName} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
