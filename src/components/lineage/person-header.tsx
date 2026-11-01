// The top of a person's pages (milestone M04): the name in every script inside the heading, the
// readings and other names labelled beneath it, one line of what the record says (life, place at
// city level, lineages, founder, who keeps the record), the switch between profile, list and
// graph, and the counts for the side rail of a wide screen. On a phone the first screen goes to
// the lineage itself (design direction, decision 10), so the counts sit in the section headings.

import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';

import { NameText } from '@/components/account/person-names';
import { LockIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import type { LineageRefDto, PersonProfileDto } from '@/server/dto/public';
import { aliases, LineageName, originalNames, readingLabel, readingLang, readings } from './person-name';
import { Sep } from './relation-list';
import { claimText, lifeText } from './status';

const regionNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });

/** "Demo Harbour City, Hong Kong", "Bulgaria" or null: never more precise than the city (plan §6.4). */
export function placeText(profile: Pick<PersonProfileDto, 'cityName' | 'countryCode'>): string | null {
  const country = profile.countryCode ? (regionNames.of(profile.countryCode) ?? profile.countryCode) : null;
  return [profile.cityName, country].filter(Boolean).join(', ') || null;
}

/** "1,234" or "1,000+" when the count stopped at its cap. */
export const countText = (n: number, capped = false) => `${n.toLocaleString('en')}${capped ? '+' : ''}`;

/**
 * The lineages whose recorded root is this person. DEFAULT D22: a founder is named only when the
 * record says so ("as recorded"), never inferred from an empty list of teachers.
 */
export function foundedLineages(profile: Pick<PersonProfileDto, 'id' | 'lineages'>): LineageRefDto[] {
  return profile.lineages.filter((l) => l.rootPersonId === profile.id);
}

/**
 * The page heading: the Latin-script name and every original script, each with its own `lang`.
 * The readings stay out of it (PersonReadings), so heading navigation hears the name only.
 */
export function PersonHeading({ profile, prefix }: { profile: Pick<PersonProfileDto, 'displayName' | 'altNames'>; prefix?: string }) {
  return (
    <h1 className="flex flex-wrap items-baseline gap-x-[0.42em] font-display text-feature [overflow-wrap:anywhere]">
      {prefix ? <span className="sr-only">{prefix}</span> : null}
      <NameText name={{ value: profile.displayName, lang: 'und-Latn' }} />
      {originalNames(profile.altNames).map((name) => (
        <NameText key={`${name.lang}-${name.value}`} name={name} className="text-[0.74em] text-fg-muted" />
      ))}
    </h1>
  );
}

/** "JYUTPING ho4 sek6 zuk1 · PINYIN Hé Shízhú · ALSO KNOWN AS Hugo Cheung", labelled. */
export function PersonReadings({ profile }: { profile: Pick<PersonProfileDto, 'altNames'> }) {
  const read = readings(profile.altNames);
  const known = aliases(profile.altNames);
  if (read.length === 0 && known.length === 0) return null;
  const item = (key: string, label: string, value: ReactNode) => (
    <div key={key} className="flex items-baseline gap-2">
      <dt className="text-caption text-fg-subtle uppercase">{label}</dt>
      <dd className="text-ui text-fg-muted">{value}</dd>
    </div>
  );
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1">
      {read.map((name) =>
        item(
          `${name.lang}-${name.romanization}-${name.value}`,
          readingLabel(name),
          <NameText name={{ value: name.value, lang: readingLang(name) }} />,
        ),
      )}
      {known.length > 0
        ? item(
            'aliases',
            'Also known as',
            known.map((name, i) => (
              <Fragment key={`${name.lang}-${name.value}`}>
                {i > 0 ? ', ' : null}
                <NameText name={name} />
              </Fragment>
            )),
          )
        : null}
    </dl>
  );
}

/** One line of what the record says: life, place, lineages, founder, record keeper. */
export function FactStrip({ profile, className }: { profile: PersonProfileDto; className?: string }) {
  const founded = foundedLineages(profile);
  const facts: { key: string; node: ReactNode }[] = [];
  if (!profile.limited && profile.lifeStatus !== 'unknown') facts.push({ key: 'life', node: lifeText(profile.lifeStatus, profile.kind) });
  const place = placeText(profile);
  if (place) facts.push({ key: 'place', node: place });
  for (const lineage of profile.lineages) {
    facts.push({
      key: `lineage-${lineage.id}`,
      node: founded.includes(lineage) ? (
        <>
          Founder of <LineageName name={lineage.name} /> (as recorded)
        </>
      ) : (
        <LineageName name={lineage.name} />
      ),
    });
  }
  if (profile.claimState !== 'unknown') facts.push({ key: 'record', node: claimText(profile.claimState) });
  // M10b (DEFAULT D04/D13): a Sifu account chose its type itself; an archivist verifies it.
  if (profile.instructor) {
    facts.push({
      key: 'instructor',
      node: <span data-testid="instructor-fact" data-instructor={profile.instructor}>{profile.instructor === 'verified' ? 'Instructor' : 'Instructor (unverified)'}</span>,
    });
  }
  return (
    <p className={cx('text-ui text-fg-muted', className)}>
      {facts.map((fact, i) => (
        <Fragment key={fact.key}>
          {i > 0 ? <Sep /> : null}
          <span>{fact.node}</span>{' '}
        </Fragment>
      ))}
    </p>
  );
}

/**
 * Profile, list and graph of one person. The graph is the explorer (M05), at /explore?focus=<id>.
 * Before M05 its place said "soon", as a link that was switched off; the `soon` branch below stays
 * for a view that is not built yet.
 */
export function PersonViews({ profile, current }: { profile: Pick<PersonProfileDto, 'slug' | 'id'>; current: 'profile' | 'list' }) {
  const views: readonly { key: string; label: string; href: string | null; soon: boolean }[] = [
    { key: 'profile', label: 'Profile', href: `/people/${profile.slug}`, soon: false },
    { key: 'list', label: 'List', href: `/people/${profile.slug}/lineage`, soon: false },
    { key: 'graph', label: 'Graph', href: `/explore?focus=${profile.id}`, soon: false },
  ];
  const item = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-xs px-3.5 text-ui font-semibold';
  return (
    <nav aria-label="Views of this person">
      <ul className="inline-flex max-w-full flex-wrap rounded-sm border border-border-strong p-0.5">
        {views.map((view) => (
          <li key={view.key}>
            {view.href === null ? (
              <span role="link" aria-disabled="true" className={cx(item, 'cursor-default text-fg-subtle')}>
                {view.label}{' '}
                <span className="text-caption font-normal uppercase">soon</span>
              </span>
            ) : (
              <Link
                href={view.href}
                prefetch={false}
                aria-current={view.key === current ? 'page' : undefined}
                className={cx(item, 'text-fg-muted hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-fg aria-[current=page]:text-fg-inverse')}
              >
                {view.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** "+1 pending, visible to you": the viewer's own requests, beside a public count. */
export function pendingText(n: number): string {
  return `+${n.toLocaleString('en')} pending, visible to you`;
}

/**
 * Teachers, students and descendants for the side rail, counted from public relationships only
 * (DEFAULT D03). `pending` notes the viewer's own requests shown on the page, which never count.
 */
export function PersonCounts({
  profile,
  pending = { teachers: 0, students: 0 },
  className,
}: {
  profile: PersonProfileDto;
  pending?: { teachers: number; students: number };
  className?: string;
}) {
  const stats = [
    { key: 'teachers', label: 'Teachers', value: countText(profile.counts.teachers), pending: pending.teachers },
    { key: 'students', label: 'Students', value: countText(profile.counts.students), pending: pending.students },
    { key: 'descendants', label: 'Descendants', value: countText(profile.counts.descendants, profile.counts.descendantsCapped), pending: 0 },
  ];
  return (
    <dl className={cx('grid grid-cols-[repeat(auto-fit,minmax(min(100%,6.5rem),1fr))] gap-x-4 gap-y-3', className)}>
      {stats.map((s) => (
        <div key={s.key} className="grid min-w-0 content-start">
          <dt className="text-caption text-fg-subtle uppercase">{s.label}</dt>
          <dd className="font-display text-2xl tabular" data-count={s.key}>
            {s.value}
          </dd>
          {s.pending > 0 ? <dd className="text-sm text-fg-muted">{pendingText(s.pending)}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

/** The notice on a record only the viewer (and the people in its requests) can see. */
export function PrivateRecordNotice({ own, limited }: { own: boolean; limited: boolean }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-sm border-l-4 border-border-strong bg-surface-2 px-4 py-3 text-ui">
      <LockIcon size={18} className="mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">Private record.</strong>{' '}
        {own
          ? 'Only you and the people in your pending links can see this page. It becomes public when a link is confirmed and you choose to show it.'
          : limited
            ? 'You see only the names, because of your own request to this person. The rest of the record stays private until they answer.'
            : 'You can see it because you are part of one of its pending links. Nobody else can until a link is confirmed.'}
      </span>
    </p>
  );
}
