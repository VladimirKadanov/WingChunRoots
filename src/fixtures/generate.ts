// Deterministic generator of the fictional demo data (milestone M01, In scope 10).
// DEFAULT D20: only clearly fictional people with `demo-` slugs and "Fictional demo record" in
// every biography; real people, lineages, dates and ranks are never generated.
//
// generateFixtures(seed) returns every row `pnpm db:seed` inserts: about 600 people in three
// lineages with two hubs, parallel teachers in one lineage, teachers from another lineage,
// historical-only relationships, every relationship status of plan §6.7, names in Latin,
// Chinese (Traditional and Simplified, with Jyutping and pinyin) and Cyrillic, fictional
// schools in real GeoNames cities, and the anchor records with fixed slugs that the tests of
// later milestones rely on. Same seed, same rows, byte for byte: ids are UUIDv7 built from the
// seed and timestamps come from a fixed base date, never from the clock.
//
// toLineageExport() turns the public part of the data into the graph format of plan §6.3
// (fixtures/lineage-600.json, for M03 and M05). fixtureStats() measures the ranges the
// integration tests check.

import { createHash } from 'node:crypto';

import { uuidv7FromParts } from '../server/db/ids';
import type {
  authAccount,
  authTwoFactor,
  authUser,
  consentRecord,
  entitlementGrant,
  invitation,
  lineage,
  organization,
  organizationMembership,
  person,
  personBio,
  personName,
  place,
  relationshipEvent,
  reviewCase,
  reviewNote,
  school,
  schoolInstructor,
  schoolPrivateLocation,
  teachingRelationship,
  trainingPeriod,
} from '../server/db/schema';
import {
  ACTIVE_RELATIONSHIP_STATUSES,
  PUBLIC_RELATIONSHIP_STATUSES,
  PUBLISHABLE_RELATIONSHIP_STATUSES,
  RELATIONSHIP_STATUSES,
} from '../server/db/schema/common';
import { consentVersion, SIGN_UP_CONSENTS } from '../server/legal/documents';
import { GEONAMES_CITIES, type GeoNamesCity } from './geonames-cities';
import {
  CYRILLIC_GIVEN,
  CYRILLIC_SURNAMES,
  HAN_GIVEN,
  HAN_SURNAMES,
  type HanChar,
  WESTERN_GIVEN,
  WESTERN_SURNAMES,
} from './names';
import { createRandom, type Random } from './random';

export const FIXTURE_SEED = 20261016;
export const TARGET_PERSONS = 600;
/** Every biography contains this phrase (D20). */
export const FICTIONAL_MARK = 'Fictional demo record';
/** Fixed base time of all fixture ids and timestamps: 2026-01-01T00:00:00Z. */
const BASE_MS = Date.UTC(2026, 0, 1);
/** Fixed time of the demo accounts (M02): 2026-02-01T00:00:00Z, after every archival record. */
const ACCOUNT_BASE_MS = Date.UTC(2026, 1, 1);
const LAST_YEAR = 2025;

/** Anchor records with fixed slugs (milestone M01, In scope 10). */
export const ANCHOR_PERSON_SLUGS = [
  'demo-root-a',
  'demo-root-b',
  'demo-root-c',
  'demo-shared-ancestor',
  'demo-hub-a',
  'demo-hub-b',
  'demo-two-lineages',
  'demo-converging',
  'demo-historical-only',
  'demo-pending',
  'demo-under-review',
  'demo-arbitration',
  'demo-claim-only-teacher',
  'demo-cjk-name',
  'demo-cyrillic-name',
  'demo-latin-name',
  'demo-free-sifu-5',
  'demo-pro-sifu-8',
] as const;
export const ANCHOR_SCHOOL_SLUGS = ['demo-school-city-only', 'demo-school-two-lineages'] as const;
export type AnchorSlug = (typeof ANCHOR_PERSON_SLUGS)[number] | (typeof ANCHOR_SCHOOL_SLUGS)[number];

/**
 * Sign-in accounts for the tests (milestone M02, In scope 9), never in production: one linked to
 * each of these anchor records (stewardship = self), plus three staff accounts without a record.
 * E-mail: `<slug>@example.test`. The seed adds the credentials from E2E_PASSWORD and, for staff,
 * the TOTP secret from E2E_TOTP_SECRET (src/server/db/seed.ts).
 */
export const DEMO_PERSON_ACCOUNT_SLUGS = [
  'demo-pending',
  'demo-root-a',
  'demo-hub-a',
  'demo-free-sifu-5',
  'demo-pro-sifu-8',
  'demo-two-lineages',
] as const;
export const DEMO_STAFF_ACCOUNTS = [
  { slug: 'demo-admin', role: 'admin', name: 'Demo Admin' },
  { slug: 'demo-archivist', role: 'archivist', name: 'Demo Archivist' },
  { slug: 'demo-moderator', role: 'moderator', name: 'Demo Moderator' },
] as const;
export type DemoAccountSlug =
  | (typeof DEMO_PERSON_ACCOUNT_SLUGS)[number]
  | (typeof DEMO_STAFF_ACCOUNTS)[number]['slug'];
export const DEMO_ACCOUNT_SLUGS: readonly DemoAccountSlug[] = [
  ...DEMO_PERSON_ACCOUNT_SLUGS,
  ...DEMO_STAFF_ACCOUNTS.map((a) => a.slug),
];
export const demoAccountEmail = (slug: DemoAccountSlug): string => `${slug}@example.test`;

type Row<T extends { $inferInsert: object }> = Required<T['$inferInsert']>;
export type LineageRow = Row<typeof lineage>;
export type PersonRow = Row<typeof person>;
export type PersonNameRow = Row<typeof personName>;
export type PersonBioRow = Row<typeof personBio>;
export type RelationshipRow = Row<typeof teachingRelationship>;
export type TrainingPeriodRow = Row<typeof trainingPeriod>;
export type RelationshipEventRow = Row<typeof relationshipEvent>;
export type PlaceRow = Row<typeof place>;
export type SchoolRow = Row<typeof school>;
export type SchoolPrivateLocationRow = Row<typeof schoolPrivateLocation>;
export type SchoolInstructorRow = Row<typeof schoolInstructor>;
export type OrganizationRow = Row<typeof organization>;
export type OrganizationMembershipRow = Row<typeof organizationMembership>;
export type ReviewCaseRow = Row<typeof reviewCase>;
export type ReviewNoteRow = Row<typeof reviewNote>;
export type InvitationRow = Row<typeof invitation>;
export type AuthUserRow = Row<typeof authUser>;
export type ConsentRecordRow = Row<typeof consentRecord>;
export type EntitlementGrantRow = Row<typeof entitlementGrant>;
/** A credential account without its password hash, which the seed adds (secret, env-dependent). */
export type CredentialShell = Omit<Row<typeof authAccount>, 'password'>;
/** A TOTP row without its encrypted secret and backup codes, which the seed adds. */
export type TwoFactorShell = Omit<Row<typeof authTwoFactor>, 'secret' | 'backupCodes'>;

export interface Fixtures {
  seed: number;
  lineages: LineageRow[];
  persons: PersonRow[];
  personNames: PersonNameRow[];
  personBios: PersonBioRow[];
  relationships: RelationshipRow[];
  trainingPeriods: TrainingPeriodRow[];
  relationshipEvents: RelationshipEventRow[];
  places: PlaceRow[];
  schools: SchoolRow[];
  schoolPrivateLocations: SchoolPrivateLocationRow[];
  schoolInstructors: SchoolInstructorRow[];
  organizations: OrganizationRow[];
  organizationMemberships: OrganizationMembershipRow[];
  reviewCases: ReviewCaseRow[];
  reviewNotes: ReviewNoteRow[];
  invitations: InvitationRow[];
  /** Fixed slug → id, for tests and later milestones. */
  anchors: Record<AnchorSlug, string>;
  /** Demo sign-in accounts (M02) and their consents of sign-up. */
  users: AuthUserRow[];
  /** Plans of the demo accounts (M08): the Pro Sifu test plan of demo-pro-sifu-8. */
  entitlementGrants: EntitlementGrantRow[];
  consentRecords: ConsentRecordRow[];
  credentials: CredentialShell[];
  twoFactors: TwoFactorShell[];
  /** Account slug → auth_user.id. */
  accounts: Record<DemoAccountSlug, string>;
}

type LineageKey = 'a' | 'b' | 'c';
type NameStyle = 'cjk' | 'western' | 'cyrillic';
type Status = (typeof RELATIONSHIP_STATUSES)[number];
type PeriodShape = 'ongoing' | 'ended';

interface P {
  row: PersonRow;
  gen: number;
  lineage: LineageKey | null;
  anchor: boolean;
}

interface NameSpec {
  kind: PersonNameRow['kind'];
  value: string;
  script: string;
  lang: string;
  romanization: PersonNameRow['romanization'];
}

const LINEAGE_COUNTRIES: Record<LineageKey, readonly string[]> = {
  a: ['BG', 'GR', 'DE', 'BG', 'GB'],
  b: ['HK', 'GB', 'US', 'HK', 'DE'],
  c: ['DE', 'US', 'GB', 'GR', 'BG'],
};

const ESTABLISHED: ReadonlySet<string> = new Set(PUBLIC_RELATIONSHIP_STATUSES);

class Builder {
  readonly rng: Random;
  private readonly idRng: Random;
  private idSeq = 0;
  private minute = 0;

  readonly lineages = {} as Record<LineageKey, LineageRow>;
  readonly persons: P[] = [];
  readonly names: PersonNameRow[] = [];
  readonly bios: PersonBioRow[] = [];
  readonly rels: RelationshipRow[] = [];
  readonly periods: TrainingPeriodRow[] = [];
  readonly events: RelationshipEventRow[] = [];
  readonly bySlug = new Map<string, P>();
  readonly byId = new Map<string, P>();

  constructor(seed: number) {
    this.rng = createRandom(seed);
    this.idRng = createRandom((seed ^ 0x5eed_1d5) >>> 0);
  }

  id(): string {
    const seq = this.idSeq++;
    return uuidv7FromParts(BASE_MS + seq, 0, this.idRng.bytes(8));
  }

  /** A strictly increasing fixture timestamp. */
  tick(minutes = 1): Date {
    this.minute += minutes;
    return new Date(BASE_MS + this.minute * 60_000);
  }

  lineage(key: LineageKey): void {
    const at = this.tick();
    this.lineages[key] = {
      id: this.id(),
      slug: `demo-lineage-${key}`,
      name: `Demo Lineage ${key.toUpperCase()}`,
      rootPersonId: null,
      description: `${FICTIONAL_MARK}: a made-up lineage for tests and the local pilot.`,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
  }

  person(opts: {
    slug?: string;
    gen: number;
    lineage: LineageKey | null;
    historical?: boolean;
    style?: NameStyle;
    names?: NameSpec[];
    role: string;
    stewardship?: PersonRow['stewardship'];
  }): P {
    const at = this.tick();
    const historical = opts.historical ?? false;
    const slug = opts.slug ?? this.nextSlug(opts.lineage);
    const countries = opts.lineage ? LINEAGE_COUNTRIES[opts.lineage] : ['HK'];
    const row: PersonRow = {
      id: this.id(),
      slug,
      kind: historical ? 'historical' : 'living',
      lifeStatus: historical ? 'deceased' : 'living',
      stewardship: opts.stewardship ?? (historical ? 'platform' : 'unclaimed'),
      visibility: 'involved_only', // computed in finish(): DEFAULT D03
      claimedByUserId: null,
      createdByUserId: null,
      countryCode: this.rng.pick(countries),
      placeId: null,
      trainingStartYear: null,
      birthDate: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    };
    const p: P = { row, gen: opts.gen, lineage: opts.lineage, anchor: opts.slug !== undefined };
    this.persons.push(p);
    this.bySlug.set(slug, p);
    this.byId.set(row.id, p);

    const names = opts.names ?? this.randomNames(opts.style ?? this.randomStyle());
    names.forEach((n, i) => {
      this.names.push({
        id: this.id(),
        personId: row.id,
        kind: n.kind,
        value: n.value,
        script: n.script,
        lang: n.lang,
        romanization: n.romanization,
        isPrimary: i === 0,
        sortOrder: i,
        createdAt: at,
        updatedAt: at,
      });
    });
    const lineageText = opts.lineage ? ` in Demo Lineage ${opts.lineage.toUpperCase()}` : '';
    this.bios.push({
      id: this.id(),
      personId: row.id,
      lang: 'en',
      body: `${FICTIONAL_MARK}. ${names[0]!.value} is a made-up ${opts.role}${lineageText}; any resemblance to a real person is coincidental.`,
      createdAt: at,
      updatedAt: at,
    });
    return p;
  }

  private slugCounters: Record<string, number> = {};
  private nextSlug(lineageKey: LineageKey | null): string {
    const k = lineageKey ?? 'x';
    const n = (this.slugCounters[k] = (this.slugCounters[k] ?? 0) + 1);
    return `demo-${k}-${String(n).padStart(3, '0')}`;
  }

  private randomStyle(): NameStyle {
    const r = this.rng.next();
    if (r < 0.45) return 'cjk';
    if (r < 0.95) return 'western';
    return 'cyrillic';
  }

  randomNames(style: NameStyle): NameSpec[] {
    const rng = this.rng;
    if (style === 'cjk') {
      const surname = rng.pick(HAN_SURNAMES);
      const g1 = rng.pick(HAN_GIVEN);
      let g2 = rng.pick(HAN_GIVEN);
      while (g2 === g1) g2 = rng.pick(HAN_GIVEN);
      return cjkNames(surname, [g1, g2], {
        simplified: rng.chance(0.5),
        alias: rng.chance(0.15) ? `${rng.pick(WESTERN_GIVEN)} ${surname.hk}` : null,
      });
    }
    if (style === 'cyrillic') {
      const given = rng.pick(CYRILLIC_GIVEN);
      const surname = rng.pick(CYRILLIC_SURNAMES);
      const [cyr, lat] = given.female ? surname.f : surname.m;
      return cyrillicNames(`${given.cyr} ${cyr}`, `${given.lat} ${lat}`);
    }
    return [latinName(`${rng.pick(WESTERN_GIVEN)} ${rng.pick(WESTERN_SURNAMES)}`, 'en')];
  }

  rel(opts: {
    teacher: P;
    student: P;
    lineage: LineageKey;
    status: Status;
    primary: boolean;
    period: PeriodShape;
    reason?: string;
  }): RelationshipRow {
    const { teacher, student } = opts;
    if (teacher.gen >= student.gen) {
      // Every edge goes from an earlier to a later generation, so the graph has no cycle.
      throw new Error(`fixture edge ${teacher.row.slug} -> ${student.row.slug} breaks the generation order`);
    }
    const created = this.tick(7);
    const committee = teacher.row.kind === 'historical' || opts.status === 'under_review';
    const wasVerified = (PUBLISHABLE_RELATIONSHIP_STATUSES as readonly string[]).includes(opts.status);
    if (opts.primary && !wasVerified) {
      // DEFAULT D05: a request never carries the display preference; verification sets it (M09).
      throw new Error(`fixture edge ${teacher.row.slug} -> ${student.row.slug}: a ${opts.status} relationship cannot be display-primary`);
    }
    const row: RelationshipRow = {
      id: this.id(),
      teacherPersonId: teacher.row.id,
      studentPersonId: student.row.id,
      lineageId: this.lineages[opts.lineage].id,
      status: opts.status,
      verificationPath: committee ? 'committee_review' : 'teacher_approval',
      isDisplayPrimary: opts.primary,
      prefersDisplayPrimary: false,
      // DEFAULT D03: a relationship becomes public when it is verified; requests stay private.
      visibility: wasVerified ? 'public' : 'involved_only',
      requestedByUserId: null,
      confirmedByUserId: null,
      confirmedAt: wasVerified ? new Date(created.getTime() + 2 * 86_400_000) : null,
      statusReason: opts.reason ?? null,
      createdAt: created,
      updatedAt: created,
    };
    this.rels.push(row);
    this.addPeriods(row, student, opts.period);
    this.addEvents(row, committee);
    return row;
  }

  private addPeriods(rel: RelationshipRow, student: P, shape: PeriodShape): void {
    const rng = this.rng;
    const startYear = Math.min(1950 + student.gen * 14 + rng.int(0, 8), LAST_YEAR - 4);
    const r = rng.next();
    const precision: TrainingPeriodRow['precision'] = r < 0.7 ? 'year' : r < 0.9 ? 'month' : r < 0.95 ? 'day' : 'unknown';
    const date = (year: number): string | null => {
      if (precision === 'unknown') return null;
      const month = precision === 'year' ? 1 : rng.int(1, 12);
      const day = precision === 'day' ? rng.int(1, 28) : 1;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    const push = (startsOn: string | null, endsOn: string | null, ongoing: boolean, sortOrder: number) =>
      this.periods.push({
        id: this.id(),
        relationshipId: rel.id,
        startsOn,
        endsOn,
        precision,
        ongoing,
        sortOrder,
        schoolId: null,
        createdAt: rel.createdAt,
        updatedAt: rel.createdAt,
      });
    if (shape === 'ended') {
      const endYear = Math.min(startYear + rng.int(3, 15), LAST_YEAR);
      push(date(startYear), date(endYear), false, 0);
      return;
    }
    if (precision !== 'unknown' && rng.chance(0.06)) {
      // A break in training: an ended period, then the current one.
      push(date(startYear), date(startYear + 2), false, 0);
      push(date(startYear + 4), null, true, 1);
      return;
    }
    push(date(startYear), null, true, 0);
  }

  private addEvents(rel: RelationshipRow, committee: boolean): void {
    const steps: { to: Status; role: string; reason: string | null }[] = [];
    const request: Status = rel.status === 'awaiting_claim' ? 'awaiting_claim' : committee ? 'under_review' : 'pending_teacher';
    steps.push({ to: request, role: 'student', reason: null });
    const verifyRole = committee ? 'archivist' : 'teacher';
    switch (rel.status) {
      case 'verified':
        steps.push({ to: 'verified', role: verifyRole, reason: null });
        break;
      case 'rejected':
        steps.push({ to: 'rejected', role: verifyRole, reason: rel.statusReason });
        break;
      case 'withdrawn':
        steps.push({ to: 'withdrawn', role: 'student', reason: rel.statusReason });
        break;
      case 'in_arbitration':
        steps.push({ to: 'verified', role: verifyRole, reason: null });
        steps.push({ to: 'in_arbitration', role: 'moderator', reason: rel.statusReason });
        break;
      case 'revoked':
        steps.push({ to: 'verified', role: verifyRole, reason: null });
        steps.push({ to: 'in_arbitration', role: 'moderator', reason: 'Fictional dispute opened for the demo data.' });
        steps.push({ to: 'revoked', role: 'moderator', reason: rel.statusReason });
        break;
      default:
        break; // pending_teacher, awaiting_claim, under_review: the request only
    }
    let from: Status | null = null;
    steps.forEach((step, i) => {
      const at = new Date(rel.createdAt.getTime() + i * 86_400_000);
      this.events.push({
        id: this.id(),
        relationshipId: rel.id,
        fromStatus: from,
        toStatus: step.to,
        actorUserId: null,
        actorRole: step.role,
        reason: step.reason,
        idempotencyKey: null,
        createdAt: at,
        updatedAt: at,
      });
      from = step.to;
    });
  }

  studentEdges(p: P): RelationshipRow[] {
    return this.rels.filter((r) => r.studentPersonId === p.row.id);
  }

  teacherEdges(p: P): RelationshipRow[] {
    return this.rels.filter((r) => r.teacherPersonId === p.row.id);
  }
}

function latinName(value: string, lang: string, romanization: PersonNameRow['romanization'] = null): NameSpec {
  return { kind: 'name', value, script: 'Latn', lang, romanization };
}

function cjkNames(surname: HanChar, given: HanChar[], opts: { simplified: boolean; alias: string | null }): NameSpec[] {
  const chars = [surname, ...given];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const names: NameSpec[] = [
    // The primary display name: Hong Kong government-style romanization (plan §5.3).
    latinName(chars.map((c) => c.hk).join(' '), 'yue-Latn', 'hk_gov'),
    { kind: 'name', value: chars.map((c) => c.trad).join(''), script: 'Hant', lang: 'zh-Hant', romanization: null },
  ];
  if (opts.simplified) {
    names.push({ kind: 'name', value: chars.map((c) => c.simp).join(''), script: 'Hans', lang: 'zh-Hans', romanization: null });
  }
  names.push(
    { kind: 'romanization', value: chars.map((c) => c.jyutping).join(' '), script: 'Latn', lang: 'yue-Latn', romanization: 'jyutping' },
    {
      kind: 'romanization',
      value: `${surname.pinyin} ${given.map((c, i) => (i === 0 ? cap(c.pinyin) : c.pinyin)).join('')}`,
      script: 'Latn',
      lang: 'zh-Latn-pinyin',
      romanization: 'pinyin',
    },
  );
  if (opts.alias) names.push({ kind: 'alias', value: opts.alias, script: 'Latn', lang: 'en', romanization: null });
  return names;
}

function cyrillicNames(cyrillic: string, latin: string): NameSpec[] {
  return [
    latinName(latin, 'bg-Latn', 'bg_streamlined'),
    { kind: 'name', value: cyrillic, script: 'Cyrl', lang: 'bg-Cyrl', romanization: null },
  ];
}

const hanByTrad = (list: readonly HanChar[], trad: string): HanChar => {
  const c = list.find((x) => x.trad === trad);
  if (!c) throw new Error(`unknown character ${trad}`);
  return c;
};

/** Generates the complete, deterministic demo data set. */
export function generateFixtures(seed: number = FIXTURE_SEED): Fixtures {
  const b = new Builder(seed);
  const rng = b.rng;
  (['a', 'b', 'c'] as const).forEach((k) => b.lineage(k));

  // --- Roots and the shared historical ancestor (DEFAULT D22: roots may be historical) --------
  const ancestor = b.person({ slug: 'demo-shared-ancestor', gen: 0, lineage: null, historical: true, style: 'cjk', role: 'historical teacher above Demo Lineages A and B' });
  const rootA = b.person({ slug: 'demo-root-a', gen: 1, lineage: 'a', style: 'cjk', role: 'founding teacher' });
  const rootB = b.person({ slug: 'demo-root-b', gen: 1, lineage: 'b', style: 'cjk', role: 'founding teacher' });
  const rootC = b.person({ slug: 'demo-root-c', gen: 1, lineage: 'c', historical: true, style: 'cjk', role: 'historical founding teacher' });
  b.lineages.a.rootPersonId = rootA.row.id;
  b.lineages.b.rootPersonId = rootB.row.id;
  b.lineages.c.rootPersonId = rootC.row.id;
  b.rel({ teacher: ancestor, student: rootA, lineage: 'a', status: 'verified', primary: true, period: 'ended' });
  b.rel({ teacher: ancestor, student: rootB, lineage: 'b', status: 'verified', primary: true, period: 'ended' });

  // --- First generation of teachers ---------------------------------------------------------
  const hubA = b.person({ slug: 'demo-hub-a', gen: 2, lineage: 'a', role: 'teacher with a large school' });
  const hubB = b.person({ slug: 'demo-hub-b', gen: 2, lineage: 'b', role: 'teacher with a large school' });
  const cjkName = b.person({
    slug: 'demo-cjk-name',
    gen: 2,
    lineage: 'b',
    role: 'teacher',
    names: cjkNames(hanByTrad(HAN_SURNAMES, '蘇'), [hanByTrad(HAN_GIVEN, '晴'), hanByTrad(HAN_GIVEN, '嵐')], {
      simplified: true,
      alias: null,
    }),
  });
  const teachersA = [hubA, ...Array.from({ length: 4 }, () => b.person({ gen: 2, lineage: 'a', role: 'teacher' }))];
  const teachersB = [hubB, cjkName, ...Array.from({ length: 3 }, () => b.person({ gen: 2, lineage: 'b', role: 'teacher' }))];
  const teachersC = Array.from({ length: 4 }, () => b.person({ gen: 2, lineage: 'c', role: 'senior teacher' }));
  for (const t of teachersA) b.rel({ teacher: rootA, student: t, lineage: 'a', status: 'verified', primary: true, period: 'ongoing' });
  for (const t of teachersB) b.rel({ teacher: rootB, student: t, lineage: 'b', status: 'verified', primary: true, period: 'ongoing' });
  // demo-root-c is historical: these relationships ended and were verified by review.
  for (const t of teachersC) b.rel({ teacher: rootC, student: t, lineage: 'c', status: 'verified', primary: true, period: 'ended' });

  // --- Students of the first generation (generation 3) --------------------------------------
  const regular3: P[] = [];
  const addStudents = (teacher: P, lineageKey: LineageKey, count: number, gen: number, into: P[]) => {
    for (let i = 0; i < count; i++) {
      const s = b.person({ gen, lineage: lineageKey, role: 'student' });
      b.rel({ teacher, student: s, lineage: lineageKey, status: 'verified', primary: true, period: 'ongoing' });
      into.push(s);
    }
  };
  addStudents(hubA, 'a', 125, 3, regular3);
  addStudents(hubB, 'b', 122, 3, regular3);
  for (const t of teachersA.slice(1)) addStudents(t, 'a', rng.int(7, 11), 3, regular3);
  for (const t of teachersB.slice(1)) addStudents(t, 'b', rng.int(7, 11), 3, regular3);
  for (const t of teachersC) addStudents(t, 'c', rng.int(9, 13), 3, regular3);

  // --- Anchor records -------------------------------------------------------------------------
  const twoLineages = b.person({ slug: 'demo-two-lineages', gen: 3, lineage: 'a', role: 'instructor who trains in two lineages' });
  b.rel({ teacher: teachersA[1]!, student: twoLineages, lineage: 'a', status: 'verified', primary: true, period: 'ongoing' });
  b.rel({ teacher: teachersB[2]!, student: twoLineages, lineage: 'b', status: 'verified', primary: false, period: 'ongoing' });
  const twoStudentA = b.person({ gen: 4, lineage: 'a', role: 'student' });
  const twoStudentB = b.person({ gen: 4, lineage: 'b', role: 'student' });
  b.rel({ teacher: twoLineages, student: twoStudentA, lineage: 'a', status: 'verified', primary: true, period: 'ongoing' });
  b.rel({ teacher: twoLineages, student: twoStudentB, lineage: 'b', status: 'verified', primary: true, period: 'ongoing' });

  const converging = b.person({ slug: 'demo-converging', gen: 3, lineage: 'a', role: 'student with two teachers in one lineage' });
  b.rel({ teacher: hubA, student: converging, lineage: 'a', status: 'verified', primary: true, period: 'ongoing' });
  b.rel({ teacher: teachersA[2]!, student: converging, lineage: 'a', status: 'verified', primary: false, period: 'ongoing' });

  const historicalOnly = b.person({ slug: 'demo-historical-only', gen: 3, lineage: 'c', role: 'former student' });
  b.rel({ teacher: teachersC[0]!, student: historicalOnly, lineage: 'c', status: 'verified', primary: true, period: 'ended' });

  // DEFAULT D03: a pending request is private; demo-pending stays involved_only.
  const pending = b.person({ slug: 'demo-pending', gen: 3, lineage: 'a', role: 'student waiting for approval' });
  b.rel({ teacher: hubA, student: pending, lineage: 'a', status: 'pending_teacher', primary: false, period: 'ongoing' });

  // A historical teacher recorded only through a student's request under review (D03).
  const claimOnly = b.person({ slug: 'demo-claim-only-teacher', gen: 2, lineage: 'c', historical: true, role: 'teacher known only from a request under review' });
  const underReview = b.person({ slug: 'demo-under-review', gen: 3, lineage: 'c', role: 'student whose evidence is under review' });
  const underReviewRel = b.rel({ teacher: claimOnly, student: underReview, lineage: 'c', status: 'under_review', primary: false, period: 'ended' });

  const arbitration = b.person({ slug: 'demo-arbitration', gen: 3, lineage: 'b', role: 'student in a disputed relationship' });
  const arbitrationRel = b.rel({
    teacher: teachersB[3]!,
    student: arbitration,
    lineage: 'b',
    status: 'in_arbitration',
    primary: true,
    period: 'ongoing',
    reason: 'Fictional dispute opened for the demo data.',
  });

  const cyrillicName = b.person({
    slug: 'demo-cyrillic-name',
    gen: 3,
    lineage: 'a',
    role: 'student',
    names: cyrillicNames('Десислава Примерова', 'Desislava Primerova'),
  });
  b.rel({ teacher: teachersA[3]!, student: cyrillicName, lineage: 'a', status: 'verified', primary: true, period: 'ongoing' });

  const latin = b.person({ slug: 'demo-latin-name', gen: 3, lineage: 'c', role: 'student', names: [latinName('Ivan Testov', 'bg-Latn')] });
  b.rel({ teacher: teachersC[1]!, student: latin, lineage: 'c', status: 'verified', primary: true, period: 'ongoing' });

  // Quotas (M08, M09): five verified students and one pending request; eight verified students.
  const freeSifu = b.person({ slug: 'demo-free-sifu-5', gen: 3, lineage: 'c', role: 'instructor on the free plan' });
  b.rel({ teacher: teachersC[2]!, student: freeSifu, lineage: 'c', status: 'verified', primary: true, period: 'ongoing' });
  const freeStudents: P[] = [];
  addStudents(freeSifu, 'c', 5, 4, freeStudents);
  const applicant = b.person({ gen: 4, lineage: 'c', role: 'student waiting for approval' });
  b.rel({ teacher: freeSifu, student: applicant, lineage: 'c', status: 'pending_teacher', primary: false, period: 'ongoing' });

  const proSifu = b.person({ slug: 'demo-pro-sifu-8', gen: 3, lineage: 'b', role: 'instructor on the Pro plan' });
  b.rel({ teacher: cjkName, student: proSifu, lineage: 'b', status: 'verified', primary: true, period: 'ongoing' });
  const proStudents: P[] = [];
  addStudents(proSifu, 'b', 8, 4, proStudents);

  // A living teacher without an account: awaiting_claim with an invitation (plan §6.7).
  const invited = b.person({ slug: 'demo-invited-teacher', gen: 2, lineage: 'a', role: 'teacher invited to claim this record' });

  // --- Generation 4: students of some generation-3 students --------------------------------
  const regular4: P[] = [];
  const gen3Teachers = rng.shuffle(regular3).slice(0, 18);
  for (const t of gen3Teachers) addStudents(t, t.lineage!, rng.int(2, 5), 4, regular4);
  // Fill up to exactly TARGET_PERSONS.
  while (b.persons.length < TARGET_PERSONS) {
    const t = rng.pick(gen3Teachers);
    addStudents(t, t.lineage!, 1, 4, regular4);
  }

  const used = new Set<string>(); // people whose shape is already decided
  const take = (pool: P[], n: number, ok: (p: P) => boolean): P[] => {
    const out: P[] = [];
    for (const p of rng.shuffle(pool)) {
      if (out.length >= n) break;
      if (used.has(p.row.id) || !ok(p)) continue;
      used.add(p.row.id);
      out.push(p);
    }
    if (out.length < n) throw new Error(`fixture generator: only ${out.length} of ${n} candidates`);
    return out;
  };
  const singleTeacher = (p: P) => b.studentEdges(p).length === 1;

  // --- Historical-only relationships: 1–3 % (with the roots and generation 2 of lineage C) ---
  for (const p of take(regular4, 3, singleTeacher)) {
    const rel = b.studentEdges(p)[0]!;
    for (const period of b.periods.filter((x) => x.relationshipId === rel.id)) {
      if (period.ongoing) {
        period.ongoing = false;
        const start = period.startsOn ? Number(period.startsOn.slice(0, 4)) : null;
        period.endsOn = start === null ? null : `${Math.min(start + 5, LAST_YEAR)}${period.startsOn!.slice(4)}`;
      }
    }
  }

  // --- Two teachers in one lineage: 6–10 % ------------------------------------------------------
  const livingTeachers = (lineageKey: LineageKey, belowGen: number, exclude: string) =>
    b.persons.filter(
      (t) =>
        t.lineage === lineageKey &&
        t.row.kind === 'living' &&
        t.gen < belowGen &&
        t.gen >= belowGen - 2 &&
        t.row.id !== exclude &&
        t !== freeSifu &&
        t !== proSifu &&
        t !== invited &&
        b.teacherEdges(t).some((r) => r.status === 'verified'),
    );
  const convergingTarget = Math.round(TARGET_PERSONS * 0.08) - 1; // demo-converging is one more
  for (const s of take([...regular3, ...regular4], convergingTarget, singleTeacher)) {
    const current = b.studentEdges(s)[0]!.teacherPersonId;
    const teacher = rng.pick(livingTeachers(s.lineage!, s.gen, current));
    b.rel({ teacher, student: s, lineage: s.lineage!, status: 'verified', primary: false, period: 'ongoing' });
  }

  // --- A teacher from another lineage: 2–4 % --------------------------------------------------
  const crossTarget = Math.round(TARGET_PERSONS * 0.03) - 1; // demo-two-lineages is one more
  for (const s of take([...regular3, ...regular4], crossTarget, singleTeacher)) {
    const other = rng.pick((['a', 'b', 'c'] as const).filter((k) => k !== s.lineage));
    const teacher = rng.pick(livingTeachers(other, s.gen, ''));
    b.rel({ teacher, student: s, lineage: other, status: 'verified', primary: false, period: 'ongoing' });
  }

  // --- The remaining statuses of plan §6.7 ------------------------------------------------------
  const otherTeacher = (s: P, teachers: P[]) => {
    const current = new Set(b.studentEdges(s).map((r) => r.teacherPersonId));
    return rng.pick(teachers.filter((t) => !current.has(t.row.id)));
  };
  const [awaitingStudent, rejectedStudent, withdrawnStudent, revokedStudent] = [
    take(regular3, 1, (p) => p.lineage === 'a' && singleTeacher(p))[0]!,
    take(regular3, 1, (p) => p.lineage === 'b' && singleTeacher(p))[0]!,
    take(regular3, 1, (p) => p.lineage === 'c' && singleTeacher(p))[0]!,
    take(regular3, 1, (p) => p.lineage === 'a' && singleTeacher(p))[0]!,
  ];
  const awaitingRel = b.rel({ teacher: invited, student: awaitingStudent, lineage: 'a', status: 'awaiting_claim', primary: false, period: 'ongoing' });
  b.rel({
    teacher: otherTeacher(rejectedStudent, teachersB),
    student: rejectedStudent,
    lineage: 'b',
    status: 'rejected',
    primary: false,
    period: 'ongoing',
    reason: 'The training details did not match (fictional).',
  });
  b.rel({
    teacher: otherTeacher(withdrawnStudent, teachersC),
    student: withdrawnStudent,
    lineage: 'c',
    status: 'withdrawn',
    primary: false,
    period: 'ongoing',
    reason: 'Withdrawn by the student (fictional).',
  });
  const revokedRel = b.rel({
    teacher: otherTeacher(revokedStudent, teachersA),
    student: revokedStudent,
    lineage: 'a',
    status: 'revoked',
    primary: false,
    period: 'ended',
    reason: 'Revoked after a fictional dispute.',
  });

  // --- Visibility: public exactly when a person has a public relationship (DEFAULT D03) -----
  const publicIds = new Set<string>();
  for (const r of b.rels) {
    if (ESTABLISHED.has(r.status) && r.visibility === 'public') {
      publicIds.add(r.teacherPersonId);
      publicIds.add(r.studentPersonId);
    }
  }
  for (const p of b.persons) p.row.visibility = publicIds.has(p.row.id) ? 'public' : 'involved_only';

  // --- Places and schools -------------------------------------------------------------------------
  const places: PlaceRow[] = GEONAMES_CITIES.map((c) => {
    const at = b.tick();
    return {
      id: b.id(),
      geonamesId: c.geonamesId,
      name: c.name,
      asciiName: c.asciiName,
      countryCode: c.countryCode,
      admin1Code: c.admin1Code,
      featureCode: c.featureCode,
      population: c.population,
      timezone: c.timezone,
      centroid: { lng: c.lng, lat: c.lat },
      createdAt: at,
      updatedAt: at,
    };
  });
  const placeOf = (name: string): { place: PlaceRow; city: GeoNamesCity } => {
    const i = GEONAMES_CITIES.findIndex((c) => c.asciiName === name);
    if (i < 0) throw new Error(`unknown city ${name}`);
    return { place: places[i]!, city: GEONAMES_CITIES[i]! };
  };
  const schoolSpecs: {
    slug: string;
    name: string;
    city: string;
    privacy: SchoolRow['locationPrivacy'];
    status: SchoolRow['status'];
    instructors: P[];
  }[] = [
    { slug: 'demo-school-sofia', name: 'Demo Wing Chun Hall Sofia', city: 'Sofia', privacy: 'exact', status: 'published', instructors: [hubA] },
    { slug: 'demo-school-city-only', name: 'Demo Training Room Plovdiv', city: 'Plovdiv', privacy: 'city_only', status: 'published', instructors: [freeSifu] },
    { slug: 'demo-school-two-lineages', name: 'Demo Two Lineages Kwoon Berlin', city: 'Berlin', privacy: 'exact', status: 'published', instructors: [twoLineages] },
    { slug: 'demo-school-athens', name: 'Demo Kwoon Athens', city: 'Athens', privacy: 'exact', status: 'published', instructors: [hubB] },
    { slug: 'demo-school-london', name: 'Demo Wing Chun Club London', city: 'London', privacy: 'city_only', status: 'published', instructors: [proSifu] },
    { slug: 'demo-school-new-york', name: 'Demo Academy New York', city: 'New York City', privacy: 'exact', status: 'published', instructors: [teachersA[1]!] },
    { slug: 'demo-school-kowloon', name: 'Demo Kwoon Kowloon', city: 'Kowloon', privacy: 'exact', status: 'published', instructors: [cjkName] },
    { slug: 'demo-school-hamburg-draft', name: 'Demo Hall Hamburg (draft)', city: 'Hamburg', privacy: 'exact', status: 'draft', instructors: [teachersB[3]!] },
  ];
  const schools: SchoolRow[] = [];
  const schoolPrivateLocations: SchoolPrivateLocationRow[] = [];
  const schoolInstructors: SchoolInstructorRow[] = [];
  for (const spec of schoolSpecs) {
    const at = b.tick();
    const { place: pl, city } = placeOf(spec.city);
    // A made-up exact point within about 2 km of the city centroid.
    const exact = {
      lng: round5(city.lng + (rng.next() - 0.5) * 0.04),
      lat: round5(city.lat + (rng.next() - 0.5) * 0.03),
    };
    const id = b.id();
    schools.push({
      id,
      slug: spec.slug,
      name: spec.name,
      placeId: pl.id,
      locationPrivacy: spec.privacy,
      // The exact point for 'exact', the city centroid for 'city_only' (plan §6.4).
      publicPoint: spec.privacy === 'exact' ? exact : { lng: city.lng, lat: city.lat },
      status: spec.status,
      description: `${FICTIONAL_MARK}: a made-up school in a real city.`,
      websiteUrl: null,
      lastActivityAt: at,
      createdByUserId: null,
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
    });
    schoolPrivateLocations.push({ schoolId: id, exactPoint: exact, addressLine: 'Fictional demo address', createdAt: at, updatedAt: at });
    spec.instructors.forEach((p, i) =>
      schoolInstructors.push({ schoolId: id, personId: p.row.id, role: i === 0 ? 'head_instructor' : 'instructor', createdAt: at, updatedAt: at }),
    );
  }

  // --- Organizations (skeleton, DEFAULT D12) -----------------------------------------------------
  const orgAt = b.tick();
  const organizations: OrganizationRow[] = [
    { id: b.id(), slug: 'demo-federation-north', name: 'Demo Federation North', kind: 'federation', status: 'active', countryCode: 'DE', websiteUrl: null, createdAt: orgAt, updatedAt: orgAt, deletedAt: null },
    { id: b.id(), slug: 'demo-association-south', name: 'Demo Association South', kind: 'association', status: 'active', countryCode: 'GR', websiteUrl: null, createdAt: orgAt, updatedAt: orgAt, deletedAt: null },
  ];
  const membership = (org: OrganizationRow, p: P, role: OrganizationMembershipRow['role']): OrganizationMembershipRow => ({
    id: b.id(),
    organizationId: org.id,
    personId: p.row.id,
    role,
    startsOn: '2020-01-01',
    endsOn: null,
    createdAt: orgAt,
    updatedAt: orgAt,
  });
  const organizationMemberships = [
    membership(organizations[0]!, rootA, 'leader'),
    membership(organizations[0]!, hubA, 'member'),
    membership(organizations[1]!, rootB, 'leader'),
    membership(organizations[1]!, hubB, 'member'),
  ];

  // --- Review cases, notes and the invitation ----------------------------------------------------
  const caseAt = b.tick();
  const reviewCases: ReviewCaseRow[] = [];
  const reviewNotes: ReviewNoteRow[] = [];
  const addCase = (
    kind: ReviewCaseRow['kind'],
    status: ReviewCaseRow['status'],
    rel: RelationshipRow,
    personId: string | null,
    resolution: ReviewCaseRow['resolution'],
    note: string,
  ) => {
    const id = b.id();
    reviewCases.push({
      id,
      kind,
      status,
      relationshipId: rel.id,
      personId,
      schoolId: null,
      openedByUserId: null,
      assignedToUserId: null,
      resolution,
      resolutionReason: resolution ? 'Decided on fictional evidence.' : null,
      resolvedAt: resolution ? caseAt : null,
      createdAt: caseAt,
      updatedAt: caseAt,
    });
    reviewNotes.push({ id: b.id(), reviewCaseId: id, authorUserId: null, body: `${FICTIONAL_MARK}: ${note}`, isInternal: true, createdAt: caseAt, updatedAt: caseAt });
  };
  addCase('historical_claim', 'open', underReviewRel, claimOnly.row.id, null, 'evidence for a historical teacher awaits review.');
  addCase('relationship_dispute', 'in_review', arbitrationRel, null, null, 'a dispute under arbitration.');
  addCase('relationship_dispute', 'resolved', revokedRel, null, 'rejected', 'the relationship was revoked.');

  const invitations: InvitationRow[] = [
    {
      id: b.id(),
      personId: invited.row.id,
      relationshipId: awaitingRel.id,
      invitedByUserId: null,
      email: 'demo-invited-teacher@example.test',
      tokenHash: createHash('sha256').update(`demo-invitation-${seed}`).digest('hex'),
      status: 'pending',
      expiresAt: new Date(caseAt.getTime() + 30 * 86_400_000),
      acceptedAt: null,
      createdAt: caseAt,
      updatedAt: caseAt,
    },
  ];

  const anchors = {} as Record<AnchorSlug, string>;
  for (const slug of ANCHOR_PERSON_SLUGS) anchors[slug] = b.bySlug.get(slug)!.row.id;
  for (const slug of ANCHOR_SCHOOL_SLUGS) anchors[slug] = schools.find((s) => s.slug === slug)!.id;

  const { instructorCases, ...accountData } = demoAccounts(seed, b);

  return {
    seed,
    lineages: [b.lineages.a, b.lineages.b, b.lineages.c],
    persons: b.persons.map((p) => p.row),
    personNames: b.names,
    personBios: b.bios,
    relationships: b.rels,
    trainingPeriods: b.periods,
    relationshipEvents: b.events,
    places,
    schools,
    schoolPrivateLocations,
    schoolInstructors,
    organizations,
    organizationMemberships,
    reviewCases: [...reviewCases, ...instructorCases],
    reviewNotes,
    invitations,
    anchors,
    ...accountData,
  };
}

/** The Sifu accounts of the demo data (M08): the others are Student accounts. */
export const DEMO_SIFU_ACCOUNT_SLUGS: readonly DemoAccountSlug[] = ['demo-free-sifu-5', 'demo-pro-sifu-8'];

/**
 * The demo sign-in accounts (M02). Their ids come from a random stream of their own, so adding
 * accounts never shifts the ids of the archival records above. From M08: the account types, the
 * Pro Sifu test plan of demo-pro-sifu-8 and the approved instructor verification of both Sifu
 * accounts (plan §6.5: the pilot's test data uses verified Sifu), appended at the end of the
 * stream so the ids of M02 stay the same.
 */
function demoAccounts(
  seed: number,
  b: Builder,
): Pick<Fixtures, 'users' | 'consentRecords' | 'credentials' | 'twoFactors' | 'accounts' | 'entitlementGrants'> & { instructorCases: ReviewCaseRow[] } {
  const idRng = createRandom((seed ^ 0x0acc_0a75) >>> 0);
  let seq = 0;
  const id = () => uuidv7FromParts(ACCOUNT_BASE_MS + seq++, 0, idRng.bytes(8));
  const at = new Date(ACCOUNT_BASE_MS);
  const users: AuthUserRow[] = [];
  const consentRecords: ConsentRecordRow[] = [];
  const credentials: CredentialShell[] = [];
  const twoFactors: TwoFactorShell[] = [];
  const accounts = {} as Record<DemoAccountSlug, string>;
  const add = (slug: DemoAccountSlug, name: string, role: AuthUserRow['role']): string => {
    const userId = id();
    const staff = role !== 'user';
    users.push({
      id: userId,
      name,
      email: demoAccountEmail(slug),
      emailVerified: true,
      image: null,
      role,
      banned: false,
      banReason: null,
      banExpires: null,
      twoFactorEnabled: staff,
      timezone: null,
      accountType: DEMO_SIFU_ACCOUNT_SLUGS.includes(slug) ? 'sifu' : 'student',
      createdAt: at,
      updatedAt: at,
    });
    // DEFAULT D10: every account ticked the four boxes of sign-up, with the current versions.
    for (const kind of SIGN_UP_CONSENTS) {
      consentRecords.push({
        id: id(),
        userId,
        kind,
        documentVersion: consentVersion(kind),
        action: 'granted',
        occurredAt: at,
        createdAt: at,
        updatedAt: at,
      });
    }
    credentials.push({
      id: id(),
      accountId: userId,
      providerId: 'credential',
      userId,
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
      createdAt: at,
      updatedAt: at,
    });
    if (staff) {
      twoFactors.push({ id: id(), userId, verified: true, failedVerificationCount: 0, lockedUntil: null, createdAt: at, updatedAt: at });
    }
    accounts[slug] = userId;
    return userId;
  };
  for (const slug of DEMO_PERSON_ACCOUNT_SLUGS) {
    const p = b.bySlug.get(slug)!;
    const displayName = b.names.find((n) => n.personId === p.row.id && n.isPrimary)!.value;
    const userId = add(slug, displayName, 'user');
    p.row.stewardship = 'self';
    p.row.claimedByUserId = userId;
  }
  for (const staff of DEMO_STAFF_ACCOUNTS) add(staff.slug, staff.name, staff.role);

  // M08: the Pro Sifu test plan (no end date) and the approved instructor verifications.
  const entitlementGrants: EntitlementGrantRow[] = [
    {
      id: id(),
      subjectUserId: accounts['demo-pro-sifu-8'],
      subjectOrganizationId: null,
      planCode: 'pro_sifu',
      source: 'test_grant',
      startsAt: at,
      endsAt: null,
      grantedByUserId: accounts['demo-admin'],
      reason: `${FICTIONAL_MARK}: the Pro Sifu test plan of the demo data.`,
      revokedAt: null,
      revokedByUserId: null,
      revokeReason: null,
      createdAt: at,
      updatedAt: at,
    },
  ];
  const instructorCases: ReviewCaseRow[] = DEMO_SIFU_ACCOUNT_SLUGS.map((slug) => ({
    id: id(),
    kind: 'instructor_verification',
    status: 'resolved',
    relationshipId: null,
    personId: b.bySlug.get(slug)!.row.id,
    schoolId: null,
    openedByUserId: accounts[slug],
    assignedToUserId: accounts['demo-archivist'],
    resolution: 'approved',
    resolutionReason: 'Decided on fictional evidence.',
    resolvedAt: at,
    createdAt: at,
    updatedAt: at,
  }));
  return { users, consentRecords, credentials, twoFactors, accounts, entitlementGrants, instructorCases };
}

function round5(x: number): number {
  return Math.round(x * 1e5) / 1e5;
}

// --- Statistics (milestone M01, Done when 2: "the statistics are in the ranges of item 10") ---

export interface FixtureStats {
  persons: number;
  lineages: number;
  hubStudents: Record<'demo-hub-a' | 'demo-hub-b', number>;
  /** People with at least two teachers in the same lineage (verified or in arbitration). */
  twoTeachersSameLineage: number;
  /** People with verified or disputed relationships in at least two lineages. */
  crossLineage: number;
  /** People whose verified or disputed relationships as a student have all ended. */
  historicalOnly: number;
  statuses: string[];
  cjkNamed: number;
  simplifiedNamed: number;
  cyrillicNamed: number;
  aliases: number;
  romanizations: Record<string, number>;
}

export const STAT_RANGES = {
  persons: [550, 650],
  lineages: [3, 3],
  hubStudentsMin: 120,
  twoTeachersSameLineage: [0.06, 0.1],
  crossLineage: [0.02, 0.04],
  historicalOnly: [0.01, 0.03],
} as const;

/** The measurements from the row arrays (the integration test measures the database too). */
export function fixtureStats(f: Fixtures): FixtureStats {
  const established = f.relationships.filter((r) => ESTABLISHED.has(r.status));
  const ongoingRel = new Set(f.trainingPeriods.filter((p) => p.ongoing).map((p) => p.relationshipId));
  const byStudent = new Map<string, RelationshipRow[]>();
  for (const r of established) {
    const list = byStudent.get(r.studentPersonId) ?? [];
    list.push(r);
    byStudent.set(r.studentPersonId, list);
  }
  let twoTeachersSameLineage = 0;
  let crossLineage = 0;
  let historicalOnly = 0;
  for (const rels of byStudent.values()) {
    const perLineage = new Map<string, Set<string>>();
    for (const r of rels) {
      const set = perLineage.get(r.lineageId) ?? new Set<string>();
      set.add(r.teacherPersonId);
      perLineage.set(r.lineageId, set);
    }
    if ([...perLineage.values()].some((s) => s.size >= 2)) twoTeachersSameLineage++;
    if (perLineage.size >= 2) crossLineage++;
    if (rels.every((r) => !ongoingRel.has(r.id))) historicalOnly++;
  }
  const hubStudents = (slug: 'demo-hub-a' | 'demo-hub-b') =>
    new Set(established.filter((r) => r.teacherPersonId === f.anchors[slug]).map((r) => r.studentPersonId)).size;
  const peopleWith = (pred: (n: PersonNameRow) => boolean) => new Set(f.personNames.filter(pred).map((n) => n.personId)).size;
  const romanizations: Record<string, number> = {};
  for (const n of f.personNames) if (n.romanization) romanizations[n.romanization] = (romanizations[n.romanization] ?? 0) + 1;
  return {
    persons: f.persons.length,
    lineages: f.lineages.length,
    hubStudents: { 'demo-hub-a': hubStudents('demo-hub-a'), 'demo-hub-b': hubStudents('demo-hub-b') },
    twoTeachersSameLineage,
    crossLineage,
    historicalOnly,
    statuses: [...new Set(f.relationships.map((r) => r.status))].sort(),
    cjkNamed: peopleWith((n) => n.script === 'Hant'),
    simplifiedNamed: peopleWith((n) => n.script === 'Hans'),
    cyrillicNamed: peopleWith((n) => n.script === 'Cyrl'),
    aliases: f.personNames.filter((n) => n.kind === 'alias').length,
    romanizations,
  };
}

// --- Export in the graph format of plan §6.3 (fixtures/lineage-600.json) -----------------------

export interface ExportPeriod {
  from: string | null;
  to: string | null;
  ongoing: boolean;
  precision: string;
}
export interface ExportNode {
  id: string;
  displayName: string;
  altNames: { value: string; lang: string; script: string; kind: string; romanization: string | null }[];
  lifeStatus: string;
  claimState: 'claimed' | 'unclaimed' | 'platform';
  lineageIds: string[];
  childCount: number;
  hasMoreChildren: boolean;
}
export interface ExportEdge {
  id: string;
  teacherId: string;
  studentId: string;
  lineageId: string;
  kind: 'primary' | 'converging' | 'crossLineage';
  status: string;
  isDisplayPrimary: boolean;
  visibility: string;
  periods: ExportPeriod[];
}
export interface LineageExport {
  focusId: string;
  dataVersion: string;
  nodes: ExportNode[];
  edges: ExportEdge[];
  hiddenCounts: Record<string, { teachers: number; students: number }>;
  /** Not part of plan §6.3: fixed slug → id of the anchor records, for tests. */
  anchors: Record<string, string>;
  /** Not part of plan §6.3: id → lineage slug and name. */
  lineages: { id: string; slug: string; name: string; rootPersonId: string | null }[];
}

function formatDate(date: string | null, precision: string): string | null {
  if (!date) return null;
  if (precision === 'year') return date.slice(0, 4);
  if (precision === 'month') return date.slice(0, 7);
  return date;
}

/**
 * The public graph (what v_public_person and v_public_edge expose) in the format of plan §6.3:
 * public people, verified and disputed public relationships, nothing hidden (hiddenCounts {}).
 */
export function toLineageExport(f: Fixtures): LineageExport {
  const publicPersons = f.persons.filter((p) => p.visibility === 'public');
  const publicIds = new Set(publicPersons.map((p) => p.id));
  const edges = f.relationships.filter(
    (r) =>
      ESTABLISHED.has(r.status) &&
      r.visibility === 'public' &&
      publicIds.has(r.teacherPersonId) &&
      publicIds.has(r.studentPersonId),
  );
  const periodsByRel = new Map<string, TrainingPeriodRow[]>();
  for (const p of f.trainingPeriods) {
    const list = periodsByRel.get(p.relationshipId) ?? [];
    list.push(p);
    periodsByRel.set(p.relationshipId, list);
  }
  const edgesByStudent = new Map<string, RelationshipRow[]>();
  for (const e of edges) {
    const list = edgesByStudent.get(e.studentPersonId) ?? [];
    list.push(e);
    edgesByStudent.set(e.studentPersonId, list);
  }
  const kindOf = (e: RelationshipRow): ExportEdge['kind'] => {
    const siblings = edgesByStudent.get(e.studentPersonId)!;
    const primary = siblings.find((x) => x.isDisplayPrimary) ?? siblings[0]!;
    if (e.id === primary.id) return 'primary';
    return e.lineageId === primary.lineageId ? 'converging' : 'crossLineage';
  };
  const namesByPerson = new Map<string, PersonNameRow[]>();
  for (const n of f.personNames) {
    const list = namesByPerson.get(n.personId) ?? [];
    list.push(n);
    namesByPerson.set(n.personId, list);
  }
  const lineageIdsOf = new Map<string, Set<string>>();
  const addLineage = (personId: string, lineageId: string) => {
    const set = lineageIdsOf.get(personId) ?? new Set<string>();
    set.add(lineageId);
    lineageIdsOf.set(personId, set);
  };
  for (const e of edges) {
    addLineage(e.teacherPersonId, e.lineageId);
    addLineage(e.studentPersonId, e.lineageId);
  }
  for (const l of f.lineages) if (l.rootPersonId && publicIds.has(l.rootPersonId)) addLineage(l.rootPersonId, l.id);
  const childCount = new Map<string, number>();
  for (const e of edges) childCount.set(e.teacherPersonId, (childCount.get(e.teacherPersonId) ?? 0) + 1);

  const nodes: ExportNode[] = publicPersons.map((p) => {
    const names = (namesByPerson.get(p.id) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
    return {
      id: p.id,
      displayName: names.find((n) => n.isPrimary)!.value,
      altNames: names
        .filter((n) => !n.isPrimary)
        .map((n) => ({ value: n.value, lang: n.lang, script: n.script, kind: n.kind, romanization: n.romanization })),
      lifeStatus: p.lifeStatus,
      claimState: p.stewardship === 'self' ? 'claimed' : p.stewardship === 'platform' ? 'platform' : 'unclaimed',
      lineageIds: [...(lineageIdsOf.get(p.id) ?? [])].sort(),
      childCount: childCount.get(p.id) ?? 0,
      hasMoreChildren: false,
    };
  });
  const exportEdges: ExportEdge[] = edges.map((e) => ({
    id: e.id,
    teacherId: e.teacherPersonId,
    studentId: e.studentPersonId,
    lineageId: e.lineageId,
    kind: kindOf(e),
    status: e.status,
    isDisplayPrimary: e.isDisplayPrimary,
    visibility: e.visibility,
    periods: (periodsByRel.get(e.id) ?? [])
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({ from: formatDate(p.startsOn, p.precision), to: formatDate(p.endsOn, p.precision), ongoing: p.ongoing, precision: p.precision })),
  }));
  const body = JSON.stringify({ nodes, edges: exportEdges });
  const anchors: Record<string, string> = {};
  for (const [slug, id] of Object.entries(f.anchors)) if (publicIds.has(id)) anchors[slug] = id;
  return {
    focusId: f.anchors['demo-two-lineages'],
    dataVersion: `demo-${f.seed}-${createHash('sha256').update(body).digest('hex').slice(0, 12)}`,
    nodes,
    edges: exportEdges,
    hiddenCounts: {},
    anchors,
    lineages: f.lineages.map((l) => ({ id: l.id, slug: l.slug, name: l.name, rootPersonId: l.rootPersonId })),
  };
}

/** True when the generator covers every status of plan §6.7 (used by the unit test). */
export function coversAllStatuses(f: Fixtures): boolean {
  const seen = new Set(f.relationships.map((r) => r.status));
  return RELATIONSHIP_STATUSES.every((s) => seen.has(s));
}

/** Relationships that the partial unique index would treat as active duplicates (should be none). */
export function activeDuplicates(f: Fixtures): number {
  const active = new Set<string>(ACTIVE_RELATIONSHIP_STATUSES);
  const keys = f.relationships.filter((r) => active.has(r.status)).map((r) => `${r.teacherPersonId}|${r.studentPersonId}|${r.lineageId}`);
  return keys.length - new Set(keys).size;
}

/** The text of fixtures/lineage-600.json: one node or edge per line, so diffs stay readable. */
export function serializeLineageExport(e: LineageExport): string {
  const list = (items: readonly unknown[]) =>
    items.length === 0 ? '[]' : `[\n${items.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
  return [
    '{',
    `  "focusId": ${JSON.stringify(e.focusId)},`,
    `  "dataVersion": ${JSON.stringify(e.dataVersion)},`,
    `  "nodes": ${list(e.nodes)},`,
    `  "edges": ${list(e.edges)},`,
    `  "hiddenCounts": ${JSON.stringify(e.hiddenCounts)},`,
    `  "anchors": ${JSON.stringify(e.anchors, null, 4).replace(/\n}$/, '\n  }')},`,
    `  "lineages": ${list(e.lineages)}`,
    '}',
    '',
  ].join('\n');
}

/** Repository path of the exported graph. */
export const LINEAGE_EXPORT_PATH = 'fixtures/lineage-600.json';
