// A person in the lineage screens (plan §5.3; milestone M04): the Latin-script name, which is
// the link to their profile, with the original script beside it. Every name has its own `lang`
// and translate="no"; Chinese uses the system CJK fonts (NameText). Lineage names carry a
// founder's name as often as not, so they are never translated either.

import Link from 'next/link';

import { NameText } from '@/components/account/person-names';
import { cx } from '@/lib/cx';
import type { PublicNameDto } from '@/server/dto/public';

export interface PersonNameData {
  slug: string;
  displayName: string;
  altNames: readonly PublicNameDto[];
}

/** The names in their original scripts (Traditional, then Simplified Chinese, Cyrillic, …). */
export function originalNames(altNames: readonly PublicNameDto[]): PublicNameDto[] {
  return altNames.filter((n) => n.kind === 'name' && n.script !== 'Latn');
}

/** The first name in an original script, if the record has one. */
export function originalName(altNames: readonly PublicNameDto[]): PublicNameDto | null {
  return originalNames(altNames)[0] ?? null;
}

/** Readings such as Jyutping and pinyin. */
export function readings(altNames: readonly PublicNameDto[]): PublicNameDto[] {
  return altNames.filter((n) => n.kind === 'romanization');
}

/** Other names the person is known by (public aliases). */
export function aliases(altNames: readonly PublicNameDto[]): PublicNameDto[] {
  return altNames.filter((n) => n.kind === 'alias');
}

/** The caption of a reading: JYUTPING, PINYIN, or the generic word. */
export function readingLabel(name: Pick<PublicNameDto, 'romanization'>): string {
  if (name.romanization === 'jyutping') return 'Jyutping';
  if (name.romanization === 'pinyin') return 'Pinyin';
  return 'Reading';
}

/**
 * The `lang` of a reading: a Jyutping reading is tagged with the registered variant
 * (yue-Latn-jyutping), so a Cantonese voice does not read its tone digits as numbers.
 */
export function readingLang(name: Pick<PublicNameDto, 'lang' | 'romanization'>): string {
  if (name.romanization === 'jyutping' && name.lang === 'yue-Latn') return 'yue-Latn-jyutping';
  return name.lang;
}

export const profileHref = (slug: string) => `/people/${slug}`;

/** A Latin-script name inside a sentence: its own `lang` and translate="no", like every name. */
export function LatinName({ name }: { name: string }) {
  return <NameText name={{ value: name, lang: 'und-Latn' }} />;
}

/**
 * A lineage's name: a proper name, never rewritten by page translation. It moves to the next line
 * as a whole rather than breaking inside the name, and wraps inside only when it is wider than
 * the line itself (large text on a phone).
 */
export function LineageName({ name, className }: { name: string; className?: string }) {
  return (
    <span translate="no" className={cx('inline-block max-w-full', className)}>
      {name}
    </span>
  );
}

/** The name with its original script, without a link. */
export function PersonName({ person, className }: { person: Omit<PersonNameData, 'slug'>; className?: string }) {
  const original = originalName(person.altNames);
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-[0.42em]', className)}>
      <NameText name={{ value: person.displayName, lang: 'und-Latn' }} className="name-latin" />
      {original ? <NameText name={original} className="text-[0.84em] text-fg-muted" /> : null}
    </span>
  );
}

/**
 * The name as a link to the profile. Only the Latin name is underlined, with a hairline that
 * goes full strength on hover and focus. Lists of people can be long, so nothing is prefetched:
 * the profile renders per request. `compact` rows (the outline) are 32 px tall with a mouse and
 * keep the 44 px target on a touch screen. A `stretched` link covers its row instead (the nearest
 * positioned ancestor, at least 44 px tall): the whole register row is the target, so the name
 * itself needs no 44 px line of its own (review round 2: a hub's student list on a phone).
 */
export function PersonLink({
  person,
  compact = false,
  stretched = false,
  className,
}: {
  person: PersonNameData;
  compact?: boolean;
  stretched?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={profileHref(person.slug)}
      prefetch={false}
      className={cx(
        'name-link inline-flex items-center',
        stretched ? "after:absolute after:inset-0 after:content-['']" : compact ? 'min-h-8 pointer-coarse:min-h-11' : 'min-h-11',
        className,
      )}
    >
      <PersonName person={person} />
    </Link>
  );
}
