// The account and its own person (milestone M02, In scope 5; plan §3.2 "Better Auth and a separate
// person", §6.2). An account is not a person (DEFAULT D04): onboarding creates the account's own archival
// record, stewardship = self and claimed_by_user_id, private to the people involved until the
// owner chooses to show it (the tick starts unticked).

import { randomBytes } from 'node:crypto';

import { and, asc, eq, isNull } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser, safeNextPath } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { authTwoFactor, person, personName, place } from '../db/schema';
import { grantConsents, missingRequiredConsents } from './consent';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import {
  cleanName,
  isJyutping,
  isLatinName,
  isPinyin,
  matchesScript,
  NAME_MAX_LENGTH,
  ORIGINAL_SCRIPTS,
  originalScript,
  slugFromName,
} from './names';

// --- Countries -----------------------------------------------------------------------------------

const regionNames = new Intl.DisplayNames('en', { type: 'region', fallback: 'none' });
// Codes Intl names that are not countries or territories.
const NOT_A_COUNTRY = new Set(['EU', 'EZ', 'UN', 'QO', 'XA', 'XB', 'ZZ']);

export interface Country {
  code: string;
  name: string;
}

/** ISO 3166-1 alpha-2 countries and territories with their English names, sorted by name. */
export const COUNTRIES: readonly Country[] = (() => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const list: Country[] = [];
  for (const a of letters) {
    for (const b of letters) {
      const code = a + b;
      const name = NOT_A_COUNTRY.has(code) ? undefined : regionNames.of(code);
      if (name && name !== code) list.push({ code, name });
    }
  }
  return list.sort((x, y) => x.name.localeCompare(y.name, 'en'));
})();

export function isCountryCode(code: string): boolean {
  return COUNTRIES.some((c) => c.code === code);
}

// --- Input ---------------------------------------------------------------------------------------

const optionalText = z
  .string()
  .max(NAME_MAX_LENGTH * 2)
  .transform((s) => cleanName(s))
  .optional()
  .transform((s) => (s ? s : undefined));

export const onboardInput = z
  .object({
    primaryName: z.string().max(NAME_MAX_LENGTH * 2).transform((s) => cleanName(s)),
    originalName: optionalText,
    originalLang: z.string().max(16).optional().transform((s) => (s ? s : undefined)),
    jyutping: optionalText,
    pinyin: optionalText,
    countryCode: z.string().max(2).optional().transform((s) => (s ? s.toUpperCase() : undefined)),
    placeId: z.uuid().optional().or(z.literal('').transform(() => undefined)),
    // '' first: z.coerce.number() would read an empty field as 0.
    trainingStartYear: z.literal('').transform(() => undefined).or(z.coerce.number().int()).optional(),
    showPublicly: z.boolean().default(false),
  })
  .superRefine((input, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (!input.primaryName) issue('primaryName', 'Enter your name in Latin letters.');
    else if (input.primaryName.length > NAME_MAX_LENGTH) issue('primaryName', `Use at most ${NAME_MAX_LENGTH} characters.`);
    else if (!isLatinName(input.primaryName)) {
      issue('primaryName', 'Use Latin letters here (for example "So Chuk-ching"). Add the name in its own script below.');
    }
    if (input.originalName) {
      const script = input.originalLang ? originalScript(input.originalLang) : undefined;
      if (!script) issue('originalLang', 'Choose the script of this name.');
      else if (input.originalName.length > NAME_MAX_LENGTH) issue('originalName', `Use at most ${NAME_MAX_LENGTH} characters.`);
      else if (!matchesScript(input.originalName, script.lang)) issue('originalName', `This name is not written in ${script.label}.`);
    } else if (input.originalLang && !originalScript(input.originalLang)) {
      issue('originalLang', 'Choose one of the listed scripts.');
    }
    if (input.jyutping && (input.jyutping.length > NAME_MAX_LENGTH || !isJyutping(input.jyutping))) {
      issue('jyutping', 'Write Jyutping in Latin letters with tone numbers, for example "sou1 zuk1 cing4".');
    }
    if (input.pinyin && (input.pinyin.length > NAME_MAX_LENGTH || !isPinyin(input.pinyin))) {
      issue('pinyin', 'Write pinyin in Latin letters, for example "Sū Zhúqíng".');
    }
    if (input.countryCode && !isCountryCode(input.countryCode)) issue('countryCode', 'Choose a country from the list.');
    const thisYear = new Date().getUTCFullYear();
    if (input.trainingStartYear !== undefined && (input.trainingStartYear < 1900 || input.trainingStartYear > thisYear)) {
      issue('trainingStartYear', `Enter a year between 1900 and ${thisYear}.`);
    }
  });

export type OnboardInput = z.input<typeof onboardInput>;

export interface OwnPerson {
  id: string;
  slug: string;
  visibility: 'involved_only' | 'public';
  names: { value: string; lang: string; script: string; kind: string; romanization: string | null; isPrimary: boolean }[];
}

/** The fields of a failed zod parse, for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? 'form');
    fields[key] ??= issue.message;
  }
  return fields;
}

// --- Reads ---------------------------------------------------------------------------------------

export async function ownPerson(userId: string): Promise<OwnPerson | null> {
  const db = getDb();
  const [row] = await db
    .select({ id: person.id, slug: person.slug, visibility: person.visibility })
    .from(person)
    .where(and(eq(person.claimedByUserId, userId), isNull(person.deletedAt)));
  if (!row) return null;
  const names = await db
    .select({
      value: personName.value,
      lang: personName.lang,
      script: personName.script,
      kind: personName.kind,
      romanization: personName.romanization,
      isPrimary: personName.isPrimary,
    })
    .from(personName)
    .where(eq(personName.personId, row.id))
    .orderBy(asc(personName.sortOrder));
  return { ...row, names };
}

export interface AccountOverview {
  user: { id: string; email: string; role: Principal['user']['role']; twoFactorEnabled: boolean };
  session: { twoFactorVerified: boolean; via: Principal['via'] };
  /** A TOTP setup was started (`/two-factor/enable`) and waits for its first code. */
  twoFactorSetupPending: boolean;
  person: OwnPerson | null;
  /** Required consents not given for the current document versions (onboarding asks again). */
  missingConsents: string[];
}

export async function accountOverview(principal: Principal | null): Promise<AccountOverview> {
  const p = requireUser(principal);
  const [setup] = p.user.twoFactorEnabled
    ? []
    : await getDb()
        .select({ verified: authTwoFactor.verified })
        .from(authTwoFactor)
        .where(eq(authTwoFactor.userId, p.user.id));
  return {
    user: { id: p.user.id, email: p.user.email, role: p.user.role, twoFactorEnabled: p.user.twoFactorEnabled },
    session: { twoFactorVerified: p.session.twoFactorVerifiedAt !== null, via: p.via },
    twoFactorSetupPending: setup !== undefined && setup.verified === false,
    person: await ownPerson(p.user.id),
    missingConsents: await missingRequiredConsents(getDb(), p.user.id),
  };
}

export interface PlaceOption {
  id: string;
  name: string;
  countryCode: string;
}

/** The cities of the GeoNames excerpt (plan §6.2), for the onboarding form. */
export async function placeOptions(): Promise<PlaceOption[]> {
  return getDb()
    .select({ id: place.id, name: place.name, countryCode: place.countryCode })
    .from(place)
    .orderBy(asc(place.countryCode), asc(place.name));
}

export interface OnboardingOptions {
  countries: readonly Country[];
  places: PlaceOption[];
  scripts: { lang: string; label: string }[];
  /** The newest training start year the form accepts (this year). */
  latestStartYear: number;
}

/** What the onboarding form offers: countries, cities and the scripts of an original name. */
export async function onboardingOptions(principal: Principal | null): Promise<OnboardingOptions> {
  requireUser(principal);
  return {
    countries: COUNTRIES,
    places: await placeOptions(),
    scripts: ORIGINAL_SCRIPTS.map(({ lang, label }) => ({ lang, label })),
    latestStartYear: new Date().getUTCFullYear(),
  };
}

/**
 * Where a signed-in account goes next: onboarding until it has its own person, then the page it
 * asked for (`next`, a local path) or its account page.
 */
export async function landingPath(userId: string, next: unknown): Promise<string> {
  const target = safeNextPath(next, '/account');
  if (await ownPerson(userId)) return target === '/onboarding' ? '/account' : target;
  return target.startsWith('/account/security') || target.startsWith('/admin')
    ? target
    : `/onboarding${target === '/account' ? '' : `?next=${encodeURIComponent(target)}`}`;
}

// --- Onboarding ----------------------------------------------------------------------------------

/**
 * Creates the account's own person. Refused without a session (401), when the account already has
 * one (409), and while a required consent is missing (400 CONSENT_REQUIRED).
 */
export async function onboard(principal: Principal | null, raw: unknown, meta: RequestMeta): Promise<OwnPerson> {
  const p = requireUser(principal);
  const parsed = onboardInput.safeParse(raw);
  if (!parsed.success) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', fieldErrors(parsed.error));
  const input = parsed.data;
  const userId = p.user.id;

  const db = getDb();
  const missing = await missingRequiredConsents(db, userId);
  if (missing.length > 0) {
    throw new ServiceError(
      'CONSENT_REQUIRED',
      'Confirm that you are 18 or older and accept the terms and the authenticity declaration.',
      Object.fromEntries(missing.map((kind) => [kind, 'This confirmation is required.'])),
    );
  }

  let countryCode = input.countryCode ?? null;
  if (input.placeId) {
    const [city] = await db.select({ countryCode: place.countryCode }).from(place).where(eq(place.id, input.placeId));
    if (!city) throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { placeId: 'Choose a city from the list.' });
    if (countryCode && city.countryCode !== countryCode) {
      throw new ServiceError('BAD_REQUEST', 'Check the highlighted fields.', { placeId: 'This city is not in the chosen country.' });
    }
    countryCode = city.countryCode;
  }

  const script = input.originalName && input.originalLang ? originalScript(input.originalLang)! : null;
  const visibility = input.showPublicly ? ('public' as const) : ('involved_only' as const);

  const created = await db
    .transaction(async (tx) => {
      const [existing] = await tx.select({ id: person.id }).from(person).where(eq(person.claimedByUserId, userId));
      if (existing) throw new ServiceError('CONFLICT', 'Your profile already exists.');
      const [row] = await tx
        .insert(person)
        .values({
          slug: slugFromName(input.primaryName, randomBytes(4).toString('hex')),
          kind: 'living',
          lifeStatus: 'living',
          stewardship: 'self',
          visibility,
          claimedByUserId: userId,
          createdByUserId: userId,
          countryCode,
          placeId: input.placeId ?? null,
          trainingStartYear: input.trainingStartYear ?? null,
        })
        .returning({ id: person.id, slug: person.slug, visibility: person.visibility });
      const personId = row!.id;
      const names: (typeof personName.$inferInsert)[] = [
        // The language of a Latin-script name is not asked: `und-Latn` (BCP 47 "undetermined, Latin script").
        { personId, kind: 'name', value: input.primaryName, script: 'Latn', lang: 'und-Latn', isPrimary: true, sortOrder: 0 },
      ];
      if (script && input.originalName) {
        names.push({ personId, kind: 'name', value: input.originalName, script: script.script, lang: script.lang, sortOrder: 1 });
      }
      if (input.jyutping) {
        names.push({ personId, kind: 'romanization', value: input.jyutping.toLowerCase(), script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping', sortOrder: 2 });
      }
      if (input.pinyin) {
        names.push({ personId, kind: 'romanization', value: input.pinyin, script: 'Latn', lang: 'zh-Latn-pinyin', romanization: 'pinyin', sortOrder: 3 });
      }
      await tx.insert(personName).values(names);
      // The audit log keeps ids and choices, never the names (plan §6.4).
      await writeAudit(tx, {
        action: 'person.create',
        actorUserId: userId,
        actorRole: p.user.role,
        subjectType: 'person',
        subjectId: personId,
        after: {
          stewardship: 'self',
          visibility,
          names: names.map((n) => ({ kind: n.kind, script: n.script, lang: n.lang })),
          countryCode,
          placeId: input.placeId ?? null,
          trainingStartYear: input.trainingStartYear ?? null,
        },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
      if (input.showPublicly) await grantConsents(tx, userId, p.user.role, ['publication'], meta);
      return row!;
    })
    .catch((error: unknown) => {
      // Two requests at once: the unique index on claimed_by_user_id decides.
      if (pgErrorOf(error)?.constraint === 'person_claimed_by_user_id_key') {
        throw new ServiceError('CONFLICT', 'Your profile already exists.');
      }
      throw error;
    });

  return (await ownPerson(userId)) ?? { ...created, names: [] };
}

export { ORIGINAL_SCRIPTS };
