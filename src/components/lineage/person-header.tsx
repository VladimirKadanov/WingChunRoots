// The top of a person's pages (milestone M04): names with their scripts and readings, what the
// record says about the person (life, place at city level, who keeps the record, lineages), the
// counts, and the switch between profile, list and graph.

import Link from 'next/link';
import type { ReactNode } from 'react';

import { NameLine } from '@/components/account/person-names';
import { LockIcon } from '@/components/icons';
import { cx } from '@/lib/cx';
import type { PersonProfileDto } from '@/server/dto/public';
import { originalName, readings } from './person-name';
import { claimText, lifeText } from './status';

const regionNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });

/** "Demo Harbour City, Hong Kong", "Bulgaria" or null: never more precise than the city (plan §6.4). */
export function placeText(profile: Pick<PersonProfileDto, 'cityName' | 'countryCode'>): string | null {
  const country = profile.countryCode ? (regionNames.of(profile.countryCode) ?? profile.countryCode) : null;
  return [profile.cityName, country].filter(Boolean).join(', ') || null;
}

const count = (n: number, capped = false) => `${n.toLocaleString('en')}${capped ? '+' : ''}`;

export function PersonNames({ profile, className }: { profile: PersonProfileDto; className?: string }) {
  return (
    <NameLine
      primary={profile.displayName}
      original={originalName(profile.altNames)}
      readings={readings(profile.altNames)}
      className={className}
    />
  );
}

/** Profile, list and graph of one person. The graph is the explorer (M05). */
export function PersonViews({ profile, current }: { profile: Pick<PersonProfileDto, 'id' | 'slug'>; current: 'profile' | 'list' }) {
  const items = [
    { key: 'profile', label: 'Profile', href: `/people/${profile.slug}` },
    { key: 'list', label: 'List', href: `/people/${profile.slug}/lineage` },
    { key: 'graph', label: 'Graph', href: `/explore?focus=${profile.id}` },
  ] as const;
  return (
    <nav aria-label="Views of this person">
      <ul className="inline-flex rounded-sm border border-border-strong p-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              prefetch={false}
              aria-current={item.key === current ? 'page' : undefined}
              className={cx(
                'inline-flex min-h-11 min-w-16 items-center justify-center rounded-xs px-3.5 text-ui font-semibold text-fg-muted',
                'hover:bg-surface-3 hover:text-fg aria-[current=page]:bg-fg aria-[current=page]:text-fg-inverse',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-caption text-fg-subtle uppercase">{label}</dt>
      <dd className="text-ui [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

/** What the record says: life, place, record keeper, lineages. */
export function PersonFacts({ profile }: { profile: PersonProfileDto }) {
  return (
    <dl className="grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-x-6 gap-y-4">
      <Fact label="Life">{lifeText(profile.lifeStatus, profile.kind)}</Fact>
      <Fact label="Place">{placeText(profile) ?? <span className="text-fg-muted">Not recorded</span>}</Fact>
      <Fact label="Record">{claimText(profile.claimState)}</Fact>
      <Fact label={profile.lineages.length === 1 ? 'Lineage' : 'Lineages'}>
        {profile.lineages.length > 0 ? profile.lineages.map((l) => l.name).join(', ') : <span className="text-fg-muted">None on the record yet</span>}
      </Fact>
    </dl>
  );
}

/** Teachers, students and descendants, counted from public relationships only. */
export function PersonCounts({ profile }: { profile: PersonProfileDto }) {
  const stats = [
    { label: 'Teachers', value: count(profile.counts.teachers) },
    { label: 'Students', value: count(profile.counts.students) },
    { label: 'Descendants', value: count(profile.counts.descendants, profile.counts.descendantsCapped) },
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-3 border-t border-border-subtle pt-4">
      {stats.map((s) => (
        <div key={s.label} className="flex min-w-0 flex-col">
          <dt className="text-caption text-fg-subtle uppercase [overflow-wrap:anywhere]">{s.label}</dt>
          <dd className="mt-auto pt-1.5 font-display text-3xl tabular" data-count={s.label.toLowerCase()}>
            {s.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The notice on a record only the viewer (and the people in its requests) can see. */
export function PrivateRecordNotice({ own }: { own: boolean }) {
  return (
    <p role="note" className="flex items-start gap-2 rounded-sm border-l-4 border-border-strong bg-surface-2 px-4 py-3 text-ui">
      <LockIcon size={18} className="mt-0.5 shrink-0" />
      <span>
        <strong className="font-semibold">Private record.</strong>{' '}
        {own
          ? 'Only you and the people in your pending links can see this page. It becomes public when a link is confirmed and you choose to show it.'
          : 'You can see it because you are part of one of its pending links. Nobody else can until a link is confirmed.'}
      </span>
    </p>
  );
}
