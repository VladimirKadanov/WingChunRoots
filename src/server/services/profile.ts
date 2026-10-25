// The profile editor (milestone M07, In scope 1; plan §5.3, §6.2): the signed-in account edits its
// own person only: names in any script (a Latin-script primary display name is required), a short
// biography with its language, country, city, the year training started, and whether the profile
// is public. Records kept by the archive (stewardship platform or unclaimed) are edited in the
// review queue (M10a), never here.
//
// Every save is one transaction: the names are replaced and their search keys rewritten
// (src/server/search/store.ts), the change is audited as person.update (ids, kinds, scripts and
// choices, never a name or the biography; plan §6.4), and a change of "Show my profile publicly"
// grants or withdraws the `publication` consent. After the commit the public cache of the person
// and of the people and lineages next to it is dropped (invalidatePublic, plan §6.4).

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { invalidatePublic, lineageTag, personTag } from '../cache';
import { getDb } from '../db';
import { lineage, person, personBio, personName, place, teachingRelationship } from '../db/schema';
import { ROMANIZATIONS } from '../db/schema/common';
import type { Executor } from '../entitlements/access';
import { writePersonKeys } from '../search/store';
import { type Country, COUNTRIES, fieldErrors, isCountryCode, type PlaceOption } from './account';
import { currentConsents, grantConsents, withdrawConsents } from './consent';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';
import { cleanName, LANG_TAG, NAME_MAX_LENGTH, NAME_WRITINGS, nameFitsWriting, type NameWriting } from './names';

export const MAX_NAMES = 10;
export const BIO_MAX_LENGTH = 1000;

/** The languages the biography may be written in; English for now (milestone M07), the tag is kept. */
export const BIO_LANGUAGES: readonly { lang: string; label: string }[] = [
  { lang: 'en', label: 'English' },
  { lang: 'bg', label: 'Bulgarian' },
  { lang: 'zh-Hant', label: 'Chinese, Traditional characters' },
  { lang: 'zh-Hans', label: 'Chinese, Simplified characters' },
  { lang: 'de', label: 'German' },
  { lang: 'fr', label: 'French' },
  { lang: 'es', label: 'Spanish' },
  { lang: 'it', label: 'Italian' },
];

export const MISSING_PRIMARY_MESSAGE = 'Add your name in Latin letters and choose it as your display name.';
const NOT_YOURS_MESSAGE = 'You can edit only your own profile. Records kept by the archive are corrected by the archivists.';

// --- Input ---------------------------------------------------------------------------------------

const nameInput = z.object({
  kind: z.enum(['name', 'alias', 'romanization']).default('name'),
  value: z.string().max(NAME_MAX_LENGTH * 2),
  script: z.string().max(8),
  lang: z.string().max(35),
  romanization: z.enum(ROMANIZATIONS).nullable().default(null),
  isPrimary: z.boolean().default(false),
});
export type ProfileNameInput = z.input<typeof nameInput>;

/** The shape of profile.update; the rules (one Latin primary name, scripts, places) are checked by the service. */
export const profileUpdateInput = z.object({
  /** The person to edit; only the account's own person is accepted (403 otherwise). Defaults to it. */
  personId: z.uuid().optional(),
  names: z.array(nameInput).min(1, { error: MISSING_PRIMARY_MESSAGE }).max(MAX_NAMES, { error: `Add at most ${MAX_NAMES} names.` }),
  /** The biography; null removes it, and leaving it out keeps the one saved (an API client that sends only names). */
  bio: z.object({ body: z.string().max(BIO_MAX_LENGTH * 2), lang: z.string().max(35) }).nullable().optional(),
  countryCode: z.string().max(2).optional().transform((s) => (s ? s.toUpperCase() : undefined)),
  placeId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
  // '' first: z.coerce.number() would read an empty field as 0.
  trainingStartYear: z
    .union([z.literal('').transform(() => undefined), z.coerce.number().int()], { error: 'Enter the year as four digits, for example 2009.' })
    .optional(),
  // Required: an API client that leaves it out must not unpublish the profile by accident.
  showPublicly: z.boolean({ error: 'Say whether your profile is public.' }),
});
export type ProfileUpdateInput = z.input<typeof profileUpdateInput>;

interface CleanName {
  kind: 'name' | 'alias' | 'romanization';
  value: string;
  script: string;
  lang: string;
  romanization: (typeof ROMANIZATIONS)[number] | null;
  isPrimary: boolean;
}

/**
 * The rules of plan §5.3 on parsed input: exactly one primary name, in Latin letters and of kind
 * `name`; each name fits how it says it is written; a romanization is of kind `romanization`.
 * Returns the cleaned names (NFC, spaces collapsed) or throws the field errors (`names.<i>.value`,
 * `names` for the whole list).
 */
export function checkNames(names: readonly z.output<typeof nameInput>[]): CleanName[] {
  const fields: Record<string, string> = {};
  const clean = names.map((n, i): CleanName => {
    const value = cleanName(n.value);
    const at = `names.${i}`;
    const romanization = n.script === 'Latn' ? n.romanization : null;
    const kind = romanization === 'jyutping' || romanization === 'pinyin' ? 'romanization' : n.kind === 'romanization' ? 'name' : n.kind;
    if (!value) fields[`${at}.value`] = 'Enter the name, or remove this row.';
    else if (value.length > NAME_MAX_LENGTH) fields[`${at}.value`] = `Use at most ${NAME_MAX_LENGTH} characters.`;
    else if (!/^[A-Z][a-z]{3}$/.test(n.script) || !LANG_TAG.test(n.lang)) fields[`${at}.script`] = 'Choose how this name is written.';
    else if (n.romanization !== null && n.script !== 'Latn') fields[`${at}.script`] = 'Only a name in Latin letters can be a romanization.';
    else if (!nameFitsWriting(value, n.script, n.lang, romanization)) fields[`${at}.value`] = fitMessage(n.script, n.lang, romanization);
    return { kind, value, script: n.script, lang: n.lang, romanization, isPrimary: n.isPrimary };
  });
  const primaries = clean.filter((n) => n.isPrimary);
  if (primaries.length === 0) fields.names = MISSING_PRIMARY_MESSAGE;
  else if (primaries.length > 1) fields.names = 'Choose one display name.';
  else {
    const i = clean.indexOf(primaries[0]!);
    const primary = primaries[0]!;
    if (primary.script !== 'Latn' || primary.kind !== 'name' || primary.romanization === 'jyutping' || primary.romanization === 'pinyin') {
      fields.names = MISSING_PRIMARY_MESSAGE;
      fields[`names.${i}.isPrimary`] = 'Your display name must be written in Latin letters.';
    }
  }
  const seen = new Map<string, number>();
  clean.forEach((n, i) => {
    const id = `${n.script}\u0000${n.lang}\u0000${n.romanization}\u0000${n.value.toLowerCase()}`;
    if (seen.has(id) && !fields[`names.${i}.value`]) fields[`names.${i}.value`] = 'This name is already in the list.';
    seen.set(id, i);
  });
  if (Object.keys(fields).length > 0) {
    throw new ServiceError('BAD_REQUEST', fields.names ?? 'Check the highlighted fields.', fields);
  }
  return clean;
}

function fitMessage(script: string, lang: string, romanization: string | null): string {
  if (romanization === 'jyutping') return 'Write Jyutping in Latin letters with tone numbers, for example “sou1 zuk1 cing4”.';
  if (romanization === 'pinyin') return 'Write pinyin in Latin letters, for example “Sū Zhúqíng”.';
  if (script === 'Latn') return 'Use Latin letters here (for example “So Chuk-ching”), or choose the script this name is written in.';
  const writing = NAME_WRITINGS.find((w) => w.lang === lang && w.script === script);
  return writing ? `This name is not written in ${writing.label}. Type it in that script, or choose how it is written under “Written in”.` : 'Choose how this name is written.';
}

// --- Reads ---------------------------------------------------------------------------------------

export interface ProfileName {
  kind: 'name' | 'alias' | 'romanization';
  value: string;
  script: string;
  lang: string;
  romanization: string | null;
  isPrimary: boolean;
}

export interface OwnProfile {
  personId: string;
  slug: string;
  visibility: 'public' | 'involved_only';
  names: ProfileName[];
  bio: { body: string; lang: string } | null;
  countryCode: string | null;
  placeId: string | null;
  trainingStartYear: number | null;
}

export interface ProfileOptions {
  countries: readonly Country[];
  places: PlaceOption[];
  writings: readonly NameWriting[];
  bioLanguages: readonly { lang: string; label: string }[];
  latestStartYear: number;
  maxNames: number;
  bioMaxLength: number;
}

export interface ProfileView {
  /** Null until onboarding has created the account's own person. */
  profile: OwnProfile | null;
  options: ProfileOptions;
}

async function ownProfile(db: Executor, userId: string): Promise<OwnProfile | null> {
  const [row] = await db
    .select({
      id: person.id,
      slug: person.slug,
      visibility: person.visibility,
      countryCode: person.countryCode,
      placeId: person.placeId,
      trainingStartYear: person.trainingStartYear,
    })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  if (!row) return null;
  const names = await db
    .select({ kind: personName.kind, value: personName.value, script: personName.script, lang: personName.lang, romanization: personName.romanization, isPrimary: personName.isPrimary })
    .from(personName)
    .where(eq(personName.personId, row.id))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  const bios = await db.select({ body: personBio.body, lang: personBio.lang }).from(personBio).where(eq(personBio.personId, row.id)).orderBy(asc(personBio.lang));
  const bio = bios.find((b) => b.lang === 'en') ?? bios[0] ?? null;
  return {
    personId: row.id,
    slug: row.slug,
    visibility: row.visibility,
    names,
    bio,
    countryCode: row.countryCode,
    placeId: row.placeId,
    trainingStartYear: row.trainingStartYear,
  };
}

export async function profileOptions(db: Executor = getDb()): Promise<ProfileOptions> {
  return {
    countries: COUNTRIES,
    places: await db.select({ id: place.id, name: place.name, countryCode: place.countryCode }).from(place).orderBy(asc(place.countryCode), asc(place.name)),
    writings: NAME_WRITINGS,
    bioLanguages: BIO_LANGUAGES,
    latestStartYear: new Date().getUTCFullYear(),
    maxNames: MAX_NAMES,
    bioMaxLength: BIO_MAX_LENGTH,
  };
}

/** profile.get: the account's own profile for the editor, and what the editor offers. */
export async function profileGet(principal: Principal | null): Promise<ProfileView> {
  const p = requireUser(principal);
  const db = getDb();
  return { profile: await ownProfile(db, p.user.id), options: await profileOptions(db) };
}

// --- Update --------------------------------------------------------------------------------------

export interface ProfileUpdateResult {
  profile: OwnProfile;
  /** True when the save changed whether the profile is public. */
  visibilityChanged: boolean;
}

/** The cache tags a change to this person can affect: the person, its direct teachers and students, and their lineages. */
export async function neighbourTags(db: Executor, personId: string): Promise<string[]> {
  const rows = await db
    .select({ teacher: teachingRelationship.teacherPersonId, student: teachingRelationship.studentPersonId, lineageId: teachingRelationship.lineageId, rootId: lineage.rootPersonId })
    .from(teachingRelationship)
    .leftJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
    .where(or(eq(teachingRelationship.teacherPersonId, personId), eq(teachingRelationship.studentPersonId, personId)));
  const tags = [personTag(personId)];
  for (const r of rows) {
    tags.push(personTag(r.teacher), personTag(r.student), lineageTag(r.lineageId));
    if (r.rootId) tags.push(lineageTag(r.rootId));
  }
  return [...new Set(tags)];
}

/**
 * Sets whether the own person is public, inside `tx`, and records the publication consent that
 * goes with it: granted when it becomes public, withdrawn when it stops being public. Only a
 * self-stewarded record follows its owner's choice (plan §6.2). Returns whether it changed.
 */
export async function setOwnVisibility(
  tx: Executor,
  p: Principal,
  own: { id: string; visibility: 'public' | 'involved_only' },
  showPublicly: boolean,
  meta: RequestMeta,
): Promise<boolean> {
  const visibility = showPublicly ? ('public' as const) : ('involved_only' as const);
  const consents = await currentConsents(tx, p.user.id);
  if (showPublicly && !consents.has('publication')) await grantConsents(tx, p.user.id, p.user.role, ['publication'], meta);
  if (!showPublicly && consents.has('publication')) await withdrawConsents(tx, p.user.id, p.user.role, ['publication'], meta);
  if (own.visibility === visibility) return false;
  // DEFAULT D03: a self-stewarded record is public only while its owner keeps it so; unticking hides
  // it even when it has verified relationships (docs/plan/questions/M07.md, question 2).
  await tx.update(person).set({ visibility }).where(and(eq(person.id, own.id), eq(person.stewardship, 'self')));
  return true;
}

/**
 * profile.update: saves the account's own profile. Refused without a session (401), for another
 * person (403), before onboarding (404) and with field errors (400), for example without a
 * Latin-script primary name.
 */
export async function profileUpdate(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<ProfileUpdateResult> {
  const p = requireUser(principal);
  const parsed = profileUpdateInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fieldErrors(parsed.error));
  const input = parsed.data;
  const db = getDb();
  // Whose profile first: a request for another person is refused before its content is judged.
  if (input.personId) {
    const [own] = await db
      .select({ id: person.id })
      .from(person)
      .where(and(eq(person.claimedByUserId, p.user.id), eq(person.stewardship, 'self'), isNull(person.deletedAt)));
    if (own?.id !== input.personId) throw new ServiceError('FORBIDDEN', NOT_YOURS_MESSAGE);
  }
  const names = checkNames(input.names);

  const fields: Record<string, string> = {};
  const bioBody = input.bio ? input.bio.body.normalize('NFC').replace(/\r\n?/g, '\n').trim() : '';
  const bioLang = input.bio?.lang ?? 'en';
  if (bioBody.length > BIO_MAX_LENGTH) fields['bio.body'] = `Use at most ${BIO_MAX_LENGTH} characters.`;
  if (bioBody && !BIO_LANGUAGES.some((l) => l.lang === bioLang)) fields['bio.lang'] = 'Choose the language of your biography.';
  if (input.countryCode && !isCountryCode(input.countryCode)) fields.countryCode = 'Choose a country from the list.';
  const thisYear = new Date().getUTCFullYear();
  const year = input.trainingStartYear;
  if (year !== undefined && year < 1900) fields.trainingStartYear = `${year} is before 1900. Enter a year from 1900 to ${thisYear}.`;
  else if (year !== undefined && year > thisYear) fields.trainingStartYear = `${year} is after this year. Enter a year from 1900 to ${thisYear}.`;
  if (Object.keys(fields).length > 0) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fields);

  const outcome = await db.transaction(async (tx) => {
    // The own person, locked for the save: two saves at once apply one after the other.
    const [own] = await tx
      .select({
        id: person.id,
        visibility: person.visibility,
        stewardship: person.stewardship,
        countryCode: person.countryCode,
        placeId: person.placeId,
        trainingStartYear: person.trainingStartYear,
      })
      .from(person)
      // Only a self-stewarded record: one kept by the archive is corrected in the review queue (M10a).
      .where(and(eq(person.claimedByUserId, p.user.id), eq(person.stewardship, 'self'), isNull(person.deletedAt)))
      .for('update');
    if (input.personId && input.personId !== own?.id) throw new ServiceError('FORBIDDEN', NOT_YOURS_MESSAGE);
    if (!own) throw new ServiceError('NOT_FOUND', 'Create your profile first: finish setting up your account.');

    let countryCode = input.countryCode ?? null;
    if (input.placeId) {
      const [city] = await tx.select({ countryCode: place.countryCode }).from(place).where(eq(place.id, input.placeId));
      if (!city) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { placeId: 'Choose a city from the list.' });
      if (countryCode && city.countryCode !== countryCode) {
        throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { placeId: 'This city is not in the chosen country.' });
      }
      countryCode = city.countryCode;
    }

    const before = await tx
      .select({ kind: personName.kind, script: personName.script, lang: personName.lang, romanization: personName.romanization, isPrimary: personName.isPrimary })
      .from(personName)
      .where(eq(personName.personId, own.id))
      .orderBy(asc(personName.sortOrder), asc(personName.id));
    const [bioBefore] = await tx.select({ lang: personBio.lang }).from(personBio).where(eq(personBio.personId, own.id)).limit(1);

    await tx.delete(personName).where(eq(personName.personId, own.id));
    await tx.insert(personName).values(names.map((n, i) => ({ personId: own.id, ...n, sortOrder: i })));
    const keys = await writePersonKeys(tx, own.id);

    if (input.bio !== undefined) {
      await tx.delete(personBio).where(eq(personBio.personId, own.id));
      if (bioBody) await tx.insert(personBio).values({ personId: own.id, lang: bioLang, body: bioBody });
    }

    await tx
      .update(person)
      .set({ countryCode, placeId: input.placeId ?? null, trainingStartYear: input.trainingStartYear ?? null })
      .where(eq(person.id, own.id));
    const visibilityChanged = own.stewardship === 'self' ? await setOwnVisibility(tx, p, own, input.showPublicly, meta) : false;

    // Ids, kinds, scripts and choices only: never a name or the biography (plan §6.4).
    const shape = (list: readonly { kind: string; script: string; lang: string; romanization: string | null; isPrimary: boolean }[]) =>
      list.map((n) => ({ kind: n.kind, script: n.script, lang: n.lang, romanization: n.romanization, isPrimary: n.isPrimary }));
    await writeAudit(tx, {
      action: 'person.update',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'person',
      subjectId: own.id,
      before: {
        names: shape(before),
        bio: bioBefore ? { lang: bioBefore.lang } : null,
        countryCode: own.countryCode,
        placeId: own.placeId,
        trainingStartYear: own.trainingStartYear,
        visibility: own.visibility,
      },
      after: {
        names: shape(names),
        searchKeys: keys,
        bio: input.bio === undefined ? (bioBefore ? { lang: bioBefore.lang, unchanged: true } : null) : bioBody ? { lang: bioLang, length: bioBody.length } : null,
        countryCode,
        placeId: input.placeId ?? null,
        trainingStartYear: input.trainingStartYear ?? null,
        visibility: visibilityChanged ? (input.showPublicly ? 'public' : 'involved_only') : own.visibility,
      },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { personId: own.id, visibilityChanged, tags: await neighbourTags(tx, own.id) };
  });

  invalidatePublic(outcome.tags, 'procedure');
  const profile = await ownProfile(db, p.user.id);
  return { profile: profile!, visibilityChanged: outcome.visibilityChanged };
}
