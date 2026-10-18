// A person in the lineage screens (plan §5.3; milestone M04): the Latin-script name, which is
// the link to their profile, with the original script beside it. Every name has its own `lang`
// and translate="no"; Chinese uses the system CJK fonts (NameText).

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { cx } from '@/lib/cx';
import type { PublicNameDto } from '@/server/dto/public';

export interface PersonNameData {
  slug: string;
  displayName: string;
  altNames: readonly PublicNameDto[];
}

/** The name in its original script (Chinese, Cyrillic, …), if the record has one. */
export function originalName(altNames: readonly PublicNameDto[]): PublicNameDto | null {
  return altNames.find((n) => n.kind === 'name' && n.script !== 'Latn') ?? null;
}

/** Readings such as Jyutping and pinyin. */
export function readings(altNames: readonly PublicNameDto[]): PublicNameDto[] {
  return altNames.filter((n) => n.kind === 'romanization');
}

export const profileHref = (slug: string) => `/people/${slug}`;

/** A Latin-script name inside a sentence: its own `lang` and translate="no", like every name. */
export function LatinName({ name }: { name: string }) {
  return <NameText name={{ value: name, lang: 'und-Latn' }} />;
}

/** The name with its original script, without a link. */
export function PersonName({ person, className }: { person: Omit<PersonNameData, 'slug'>; className?: string }) {
  const original = originalName(person.altNames);
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-[0.42em]', className)}>
      <NameText name={{ value: person.displayName, lang: 'und-Latn' }} />
      {original ? <NameText name={original} className="text-[0.84em] text-fg-muted" /> : null}
    </span>
  );
}

/**
 * The name as a link to the profile. Lists of people can be long, so nothing is prefetched: the
 * profile renders per request.
 */
export function PersonLink({ person, className }: { person: PersonNameData; className?: string }) {
  return (
    <Link href={profileHref(person.slug)} prefetch={false} className={cx('link inline-flex min-h-11 items-center', className)}>
      <PersonName person={person} />
    </Link>
  );
}
