// The plan matrix (milestone M08; plan §6.5): the five plans of specification §3.1 as versioned
// constants in code, not a database table. Every feature carries `availability`: 'now' when it is
// part of the Phase 1 pilot release, 'planned' when a later phase brings it. An upgrade prompt
// lists only 'now' features (plan §5.6); /plans marks the others "Planned — not available yet".
//
// Pure data and pure functions: no database, no React. Routes and components may import this file
// (ESLint allows only this one from src/server/entitlements); decisions about a person's rights go
// through requireEntitlement() in src/server/entitlements/access.ts, inside a service.
//
// `source` keeps each cell of specification §3.1 word for word (plans.test.ts compares them with
// docs/WingChunRoots_Project_Specification.en.md); `label` is the English text the app shows.

import type { PLAN_CODES } from '../db/schema/common';

export type PlanCode = (typeof PLAN_CODES)[number];
export type Availability = 'now' | 'planned';
export type AccountType = 'student' | 'sifu';

/**
 * Bump on every change of a plan, a price, a value or an availability, and say what changed in
 * docs/entitlements.md. Returned by the API (plans.catalog.version); /plans does not show it.
 */
export const PLAN_MATRIX_VERSION = '2026-11-10.1';
export const PLAN_MATRIX_SOURCE = 'Project specification §3.1, consolidated source matrix';

export interface PlanPrice {
  /** Proposed monthly price in US dollars. DEFAULT D09: a working proposal, never charged in the pilot. */
  monthlyUsd: number;
  /** Proposed yearly price in US dollars, where the proposal names one (Federation). */
  yearlyUsd: number | null;
  /**
   * Shown with the label "Proposed price (not final)" (plan §5.6); a plan without a price reads
   * "Free", with no label (review round 1, design-10).
   */
  status: 'working proposal';
}

export interface PlanDefinition {
  code: PlanCode;
  /** The tier of specification §3.1. */
  tier: 'Tier 1' | 'Tier 2' | 'Tier 1-B' | 'Tier 3' | 'Tier 4';
  name: string;
  /** Who holds the plan: a Student account, a Sifu account, or an organization (Phase 3). */
  audience: AccountType | 'organization';
  /** Order within the audience: the free plan is 0. */
  rank: number;
  /** Whether the plan itself exists in the pilot; Federation arrives in Phase 3 (D12). */
  availability: Availability;
  price: PlanPrice;
  summary: string;
}

/**
 * DEFAULT D06: how many approved students Free Sifu counts (the approve_students quota below). The
 * plan summaries below and the screens that name the limit in a sentence read it from here (M08
 * final check, code-3; polish, note 2), so a new value of D06 changes them with the matrix. Defined
 * before PLANS, whose summaries use it.
 */
export const FREE_SIFU_STUDENT_LIMIT = 5;

// DEFAULT D09: $4 / $19 / $99 a month and $990 a year for a federation, as working proposals only.
const proposal = (monthlyUsd: number, yearlyUsd: number | null = null): PlanPrice => ({ monthlyUsd, yearlyUsd, status: 'working proposal' });

export const PLANS: Readonly<Record<PlanCode, PlanDefinition>> = {
  free_student: {
    code: 'free_student',
    tier: 'Tier 1',
    name: 'Free Student',
    audience: 'student',
    rank: 0,
    availability: 'now',
    price: proposal(0),
    summary: 'Your profile, your teachers and your place in the lineage network.',
  },
  premium_student: {
    code: 'premium_student',
    tier: 'Tier 2',
    name: 'Premium Student',
    audience: 'student',
    rank: 1,
    availability: 'now',
    price: proposal(4),
    summary: 'A full training passport, more photos and notices of your teachers’ events; videos once they arrive.',
  },
  free_sifu: {
    code: 'free_sifu',
    tier: 'Tier 1-B',
    name: 'Free Sifu',
    audience: 'sifu',
    rank: 0,
    availability: 'now',
    price: proposal(0),
    // DEFAULT D06: the Free Sifu limit, from FREE_SIFU_STUDENT_LIMIT (polish, note 2).
    summary: `Your identity and lineage as an instructor, with up to ${FREE_SIFU_STUDENT_LIMIT} approved students.`,
  },
  pro_sifu: {
    code: 'pro_sifu',
    tier: 'Tier 3',
    name: 'Professional Sifu',
    audience: 'sifu',
    rank: 1,
    availability: 'now',
    price: proposal(19),
    // DEFAULT D06: the limit Professional Sifu lifts, from FREE_SIFU_STUDENT_LIMIT (polish, note 2).
    summary: `Student administration without the ${FREE_SIFU_STUDENT_LIMIT}-student limit and a public pin for your school.`,
  },
  federation: {
    code: 'federation',
    tier: 'Tier 4',
    name: 'Federation',
    audience: 'organization',
    rank: 0,
    availability: 'planned',
    price: proposal(99, 990),
    summary: 'Branch administration, bulk import, certification and analytics for an organization.',
  },
};

/** The order of the columns of specification §3.1. */
export const PLAN_ORDER: readonly PlanCode[] = ['free_student', 'premium_student', 'free_sifu', 'pro_sifu', 'federation'];

export const FEATURE_KEYS = [
  'advertising',
  'identity',
  'training_start',
  'photos',
  'videos',
  'claim_teachers',
  'approve_students',
  'school_map',
  'school_business',
  'passport',
  'successor',
  'marketplace',
  'events',
  'poster',
  'almanac',
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface FeatureValue {
  /** The cell of specification §3.1, word for word. */
  source: string;
  /** What the app shows. */
  label: string;
  /**
   * Whether the plan has what the row offers: the feature itself, or for Advertising, no ads.
   * improves() and upgradeBenefits() compare it; /plans draws a check for it and a dash for its
   * absence.
   */
  included: boolean;
  /**
   * A plain fact rather than a benefit or a lack ("Browse only"): /plans draws neither a check nor
   * a dash for it (review round 1, design-4). improves() still reads `included`.
   */
  neutral?: true;
  /**
   * A countable allowance: a number, or null for "unlimited". Only on the quota features. For
   * videos (D07) it is recorded and not enforced in Phase 1; photos are enforced from M16.
   */
  limit?: number | null;
}

export interface FeatureDefinition {
  key: FeatureKey;
  /** The row of specification §3.1, word for word. */
  source: string;
  label: string;
  availability: Availability;
  /** The phase that brings a planned feature (plan §2.3); null for 'now'. */
  phase: 2 | 3 | 4 | null;
  /**
   * Enforced on the server in Phase 1 (plan §6.5): the five approved students of Free Sifu (D06),
   * the public school pin of Professional Sifu (from M11), (from M16) the photo allowance (D07) and
   * (from M17) the events a Sifu publishes a month, (from M19) what of the passport the profile shows
   * and (from M21) the weekly statistics of a school.
   */
  enforced: boolean;
  /**
   * For a feature of the pilot (availability 'now') whose screens are not built yet: when it opens,
   * in the words the app shows beside it ("Opens with schools and the map"). An upgrade prompt and
   * /plans show it, so nothing reads as usable before it is (review round 1, requirements-1,
   * design-1). Removed by the milestone that builds the feature (M09, M11).
   */
  opens?: string;
  /** The unit of a quota, for "You have approved 5 of 5 students". */
  unit?: { one: string; many: string; verb: string };
  /** The heading of an upgrade prompt at this feature's limit; `{plan}` is the higher plan's name. */
  upgradeHeading?: string;
  /** A short note for /plans, where the plain values need one. */
  note?: string;
  values: Readonly<Record<PlanCode, FeatureValue>>;
}

const yes = (label = 'Included'): FeatureValue => ({ source: 'Yes', label, included: true });
const no = (label = 'Not included'): FeatureValue => ({ source: 'No', label, included: false });
const text = (source: string, label: string = source, included = true): FeatureValue => ({ source, label, included });
const quota = (source: string, label: string, limit: number | null): FeatureValue => ({ source, label, included: limit !== 0, limit });

export const FEATURES: readonly FeatureDefinition[] = [
  {
    key: 'advertising',
    source: 'Advertising',
    label: 'Advertising',
    availability: 'planned',
    phase: 2,
    enforced: false,
    note: 'The pilot shows no advertising on any plan.',
    // The row offers no ads: "Ads shown" is the lack (a dash), "No ads" the benefit (a check).
    values: {
      free_student: { source: 'Yes', label: 'Ads shown', included: false },
      premium_student: { source: 'No', label: 'No ads', included: true },
      free_sifu: { source: 'Yes', label: 'Ads shown', included: false },
      pro_sifu: { source: 'No', label: 'No ads', included: true },
      federation: { source: 'No', label: 'No ads', included: true },
    },
  },
  {
    key: 'identity',
    source: 'Names and Kung Fu identity',
    label: 'Names and Kung Fu identity',
    availability: 'now',
    phase: null,
    enforced: false,
    values: {
      free_student: yes(),
      premium_student: yes(),
      free_sifu: yes(),
      pro_sifu: yes(),
      federation: text('Organization and leader identity'),
    },
  },
  {
    key: 'training_start',
    source: 'Training start information',
    label: 'Training history',
    availability: 'planned',
    phase: 2,
    enforced: false,
    note: 'Everyone records the year they started today; timelines and detailed histories come with the training passport.',
    values: {
      free_student: text('Start year'),
      premium_student: text('Start year and timeline'),
      free_sifu: text('Start year and experience'),
      pro_sifu: text('Detailed training history'),
      federation: text('Organization history'),
    },
  },
  {
    key: 'photos',
    source: 'Photo allowance',
    label: 'Photos',
    // M16 (owner decision 2026-11-03, docs/adr/0019-galleries.md): the profile gallery is part of
    // the pilot, so the allowance is available now and enforced on the server.
    availability: 'now',
    phase: null,
    enforced: true,
    unit: { one: 'photo', many: 'photos', verb: 'added' },
    upgradeHeading: 'More photos with {plan}',
    note: 'The profile photo is one of your photos. Evidence you send for review is private and never counts.',
    // DEFAULT D07: these allowances. M14: the one current profile photo of a person counts as 1
    // (withQuota in src/server/services/photos.ts); replacing it adds nothing. M16: every photo of
    // the person's gallery counts (src/server/services/gallery.ts), never an evidence file (DEFAULT
    // D13) and never a school's logo or room photos (their own limit). Federation's "unlimited" is
    // no limit in the pilot.
    values: {
      free_student: quota('1', '1 photo', 1),
      premium_student: quota('10', '10 photos', 10),
      free_sifu: quota('2', '2 photos', 2),
      pro_sifu: quota('100', '100 photos', 100),
      federation: quota('Unlimited in source', 'Unlimited, with limits still to be defined', null),
    },
  },
  {
    key: 'videos',
    source: 'Video allowance',
    label: 'Videos',
    availability: 'planned',
    phase: 2,
    enforced: false,
    unit: { one: 'video', many: 'videos', verb: 'added' },
    // DEFAULT D07: recorded here, enforced with the media of Phase 2.
    values: {
      free_student: quota('0', 'No videos', 0),
      premium_student: quota('2', '2 videos', 2),
      free_sifu: quota('0', 'No videos', 0),
      pro_sifu: quota('20', '20 videos', 20),
      federation: quota('Unlimited in source', 'Unlimited, with limits still to be defined', null),
    },
  },
  {
    key: 'claim_teachers',
    source: 'Claim teacher relationships',
    label: 'Name your teachers',
    availability: 'now',
    phase: null,
    enforced: false,
    values: {
      free_student: yes(),
      premium_student: yes(),
      free_sifu: yes(),
      pro_sifu: yes(),
      federation: text('Organization root and authorized relationships'),
    },
  },
  {
    key: 'approve_students',
    source: 'Approve students',
    label: 'Approve students',
    availability: 'now',
    phase: null,
    enforced: true,
    unit: { one: 'student', many: 'students', verb: 'approved' },
    upgradeHeading: 'More students with {plan}',
    // DEFAULT D06: up to 5 approved students on Free Sifu; "unlimited" means no limit in the pilot.
    values: {
      free_student: quota('No', 'Not included', 0),
      premium_student: quota('No', 'Not included', 0),
      free_sifu: quota(`Up to ${FREE_SIFU_STUDENT_LIMIT}`, `Up to ${FREE_SIFU_STUDENT_LIMIT} students`, FREE_SIFU_STUDENT_LIMIT),
      pro_sifu: quota('Unlimited in source', 'No limit', null),
      federation: quota('Unlimited within authorized scope', 'No limit within the authorized scope', null),
    },
  },
  {
    key: 'school_map',
    source: 'Public school map presence',
    label: 'School on the map',
    availability: 'now',
    phase: null,
    enforced: true,
    upgradeHeading: 'A public school pin with {plan}',
    // M11 built the map: anyone browses it; the pin needs the listing account's Professional Sifu (DEFAULT D08/D18).
    note: 'Anyone can browse the map. A public pin for a school needs the instructor who lists it to have Professional Sifu.',
    values: {
      free_student: { source: 'Browse only', label: 'Browse only', included: false, neutral: true },
      premium_student: { source: 'Browse only', label: 'Browse only', included: false, neutral: true },
      free_sifu: text('No school pin', 'No school pin', false),
      pro_sifu: text('Active school pin', 'Public pin for your school'),
      federation: text('Organization heatmap and school network'),
    },
  },
  {
    key: 'school_business',
    source: 'School schedule and business profile',
    label: 'School schedule and statistics',
    // M21 (Phase 2 "Trial lesson inquiry flow and basic school analytics", docs/adr/0024-trial-lessons.md):
    // part of the pilot. DEFAULT M21 (question 6): the schedule, the fees and the trial lesson
    // request are plain listing content of every listed school, with no plan gate; what the row
    // gates is the business side, the weekly statistics of a school (visits of its page, map
    // opens, contact clicks and trial requests), on the server (src/server/services/school-stats.ts).
    availability: 'now',
    phase: null,
    enforced: true,
    upgradeHeading: 'Weekly school statistics with {plan}',
    note: 'Every listed school shows its schedule and fees and takes trial lesson requests. Professional Sifu adds weekly statistics of page visits, map opens, contact clicks and trial requests.',
    values: {
      free_student: no(),
      premium_student: no(),
      free_sifu: { source: 'No', label: 'Schedule and fees, no statistics', included: false },
      pro_sifu: { source: 'Yes', label: 'Schedule, fees and weekly statistics', included: true },
      federation: yes(),
    },
  },
  {
    key: 'passport',
    source: 'Digital passport',
    label: 'Training passport',
    // M19 (owner's pick 2026-11-07, docs/adr/0022-passport.md): the training passport is part of
    // the pilot. What the profile shows of it follows the plan of the passport's account, decided
    // on the server (src/server/services/passport.ts). DEFAULT M19 (question 3): the free plans show
    // the current rank, the teachers with their periods and the year training began; Premium
    // Student and Professional Sifu the whole timeline (examinations, forms and skills,
    // certificates, events). "Instructor record" means a Sifu records for their own students, which
    // the pilot does not limit. A free account's entries are kept and hidden, never deleted (D08).
    availability: 'now',
    phase: null,
    enforced: true,
    upgradeHeading: 'Your full training passport with {plan}',
    note: 'Your teachers record your ranks, examinations and skills; you choose what is public. Free plans show the current rank, your teachers and the year you began; nothing is deleted on any plan.',
    values: {
      free_student: text('Basic', 'Basic: rank, teachers and start year'),
      premium_student: text('Full timeline', 'Full timeline'),
      free_sifu: text('Basic instructor record', 'Basic, and you record for your students'),
      pro_sifu: text('Full instructor record', 'Full timeline, and you record for your students'),
      federation: text('Administrative dashboard'),
    },
  },
  {
    key: 'successor',
    source: 'Digital successor',
    label: 'Digital successor',
    availability: 'planned',
    phase: 3,
    enforced: false,
    values: {
      free_student: no(),
      premium_student: no(),
      free_sifu: no(),
      pro_sifu: yes(),
      federation: yes(),
    },
  },
  {
    key: 'marketplace',
    source: 'Marketplace',
    label: 'Marketplace',
    availability: 'planned',
    phase: 4,
    enforced: false,
    values: {
      free_student: text('Buyer'),
      premium_student: text('Buyer'),
      free_sifu: text('No selling entitlement', 'No selling', false),
      pro_sifu: { source: 'Up to 20 listings', label: 'Up to 20 listings', included: true, limit: 20 },
      federation: text('Global brand catalog'),
    },
  },
  {
    key: 'events',
    source: 'Events',
    label: 'Events',
    // M17 (owner's choice 2026-11-04, docs/adr/0020-events.md): the event calendar is part of the
    // pilot. Anyone browses it; a Sifu publishes within the plan's allowance, enforced on the server.
    availability: 'now',
    phase: null,
    enforced: true,
    unit: { one: 'event', many: 'events', verb: 'published' },
    upgradeHeading: 'Publish events with {plan}',
    note: 'Anyone can browse the calendar. Publishing needs a Sifu plan that includes it; Professional Sifu counts the events that start in each calendar month.',
    // `included` is the right to publish: browsing needs no plan, so the Student cells are plain
    // facts (neutral), as for the school map. DEFAULT M17 (question 1): Professional Sifu counts
    // the published events that start in one calendar month in the event's own zone; 3 a month
    // (owner decision 2026-11-05, was 2 in the specification's source). DEFAULT D25:
    // Federation's "unlimited" is no limit in the pilot (an organization's events, M15 grant).
    values: {
      free_student: { source: 'Browse', label: 'Browse', included: false, neutral: true },
      premium_student: { source: 'Browse and notifications', label: 'Browse and notifications', included: false, neutral: true },
      free_sifu: text('No publishing entitlement', 'No publishing', false),
      pro_sifu: { source: 'Up to 3 events per month', label: 'Up to 3 events a month', included: true, limit: 3 },
      federation: text('Unlimited publishing and community push in source', 'Unlimited publishing, with limits still to be defined'),
    },
  },
  {
    key: 'poster',
    source: 'Lineage poster ordering',
    label: 'Lineage posters',
    availability: 'planned',
    phase: 4,
    enforced: false,
    values: {
      free_student: no(),
      premium_student: text('Personal'),
      free_sifu: no(),
      pro_sifu: text('School'),
      federation: text('Federation'),
    },
  },
  {
    key: 'almanac',
    source: 'Almanac inclusion',
    label: 'Almanac',
    availability: 'planned',
    phase: 4,
    enforced: false,
    note: 'Inclusion also needs your consent and the right verification.',
    values: {
      free_student: text('Purchase only'),
      premium_student: text('Name only'),
      free_sifu: text('Name and lineage'),
      pro_sifu: text('Full page with photo and biography'),
      federation: text('Premium branded section'),
    },
  },
];

/** Tier 4 extras that specification §3.1 lists below the matrix (all Phase 3). */
export const FEDERATION_EXTRAS: readonly string[] = [
  'Bulk CSV/Excel import',
  'Digital certificate issuance',
  'Organization analytics by country and city',
  'Administration of affiliated schools',
];

/**
 * Downgrade rules (DEFAULT D08, D06; plan §6.5). Recorded; only the pilot rule applies in Phase 1.
 * The paid rules arrive with payments in Phase 2.
 */
export const DOWNGRADE_RULES = {
  pilot: [
    'Revoking a test plan or switching from Sifu to Student keeps every confirmed relationship confirmed and public.',
    'Only new approvals above the limit are refused; pending requests stay pending.',
    'A school loses its public pin without being deleted (from M11).',
  ],
  paid: [
    'The paid period is honoured until it ends.',
    'Separate rules for students, Sifu and federations.',
  ],
  enforcedInPhase1: false,
} as const;

/** How /plans marks a value: a check for what the plan has, a dash for its lack, nothing for a plain fact. */
export type ValueMark = 'included' | 'not_included' | 'neutral';

export function valueMark(value: FeatureValue): ValueMark {
  if (value.neutral) return 'neutral';
  return value.included ? 'included' : 'not_included';
}

export function feature(key: FeatureKey): FeatureDefinition {
  const found = FEATURES.find((f) => f.key === key);
  if (!found) throw new Error(`unknown feature ${key}`);
  return found;
}

/** The free plan of an account type: the floor of every account (plan §6.5). */
export function freePlanFor(accountType: AccountType): PlanCode {
  return accountType === 'sifu' ? 'free_sifu' : 'free_student';
}

/** The plans of an audience from the lowest rank up. */
export function plansFor(audience: PlanDefinition['audience']): PlanDefinition[] {
  return PLAN_ORDER.map((code) => PLANS[code]).filter((p) => p.audience === audience).sort((a, b) => a.rank - b.rank);
}

/**
 * Plans an admin may give as a test or complimentary plan in the pilot (Federation is Phase 3).
 * Premium Student unlocked nothing in Phase 1 until M16: from then its photo allowance (10 instead
 * of 1, DEFAULT D07) is a benefit of the pilot (PLANS_WITHOUT_PILOT_BENEFITS is empty). The grant
 * form still says so of any plan that gives nothing of the pilot (review round 1, requirements-2).
 */
export const GRANTABLE_PLANS: readonly PlanCode[] = ['premium_student', 'pro_sifu'];

/**
 * M15: the plans an admin may give an organization as a test or complimentary plan: Federation
 * only. DEFAULT D09: its price stays a proposal ("Proposed price (not final)") and nothing is ever
 * charged; the plan itself stays 'planned' on /plans, since bulk import, the heatmap and the other
 * Federation features are later milestones. In M15 the grant opens the organization's member and
 * school administration (src/server/services/organizations.ts), and revoking it hides only that
 * (DEFAULT D08).
 */
export const ORGANIZATION_GRANTABLE_PLANS: readonly PlanCode[] = ['federation'];

/** "$19 a month", "$99 a month or $990 a year", and "Free" for a plan without a price. */
export function formatPrice(price: PlanPrice): string {
  if (price.monthlyUsd === 0) return 'Free';
  const monthly = `$${price.monthlyUsd} a month`;
  return price.yearlyUsd === null ? monthly : `${monthly} or $${price.yearlyUsd} a year`;
}

/**
 * Whether `to` gives more of a feature than `from`: a higher or unlimited allowance, or included
 * where `from` is not. A different text between two included values counts as more when `to`
 * ranks higher in the same audience.
 */
export function improves(f: FeatureDefinition, from: PlanCode, to: PlanCode): boolean {
  const a = f.values[from];
  const b = f.values[to];
  if (a.limit !== undefined || b.limit !== undefined) {
    const la = a.limit === undefined ? (a.included ? null : 0) : a.limit;
    const lb = b.limit === undefined ? (b.included ? null : 0) : b.limit;
    if (lb === null) return la !== null;
    return la !== null && lb > la;
  }
  if (!a.included) return b.included;
  if (!b.included) return false;
  return a.label !== b.label && PLANS[to].audience === PLANS[from].audience && PLANS[to].rank > PLANS[from].rank;
}

export interface Benefit {
  feature: FeatureKey;
  label: string;
  from: string;
  to: string;
  /** When a benefit of the pilot opens, while its screens are not built yet; null once it works. */
  opens: string | null;
}

/**
 * Features that joined the pilot after M08 (the photo allowance, M16; events, M17; the passport, M19; school statistics, M21): an upgrade prompt lists
 * their benefits after the ones the pilot had before, which keep the matrix's order.
 */
const JOINED_PILOT_LATER: readonly FeatureKey[] = ['photos', 'events', 'passport', 'school_business'];

/**
 * The real benefits of moving from one plan to another (plan §5.6): only features with
 * availability 'now', where `to` gives more. Planned features never appear here; a feature of the
 * pilot that is not built yet carries `opens`, which the prompt shows beside it. A prompt at a
 * limit passes that limit's feature as `lead`, so its benefit comes first (the one that was hit);
 * otherwise the matrix's order, with the features that joined the pilot later after the others.
 */
export function upgradeBenefits(from: PlanCode, to: PlanCode, lead?: FeatureKey): Benefit[] {
  const rank = (key: FeatureKey) => (key === lead ? 0 : JOINED_PILOT_LATER.includes(key) ? 2 : 1);
  return FEATURES.filter((f) => f.availability === 'now' && improves(f, from, to))
    .map((f, index) => ({ f, index }))
    .sort((a, b) => rank(a.f.key) - rank(b.f.key) || a.index - b.index)
    .map(({ f }) => ({
      feature: f.key,
      label: f.label,
      from: f.values[from].label,
      to: f.values[to].label,
      opens: f.opens ?? null,
    }));
}

/** Plans an admin can grant that give no benefit of the pilot over their free plan (Premium Student). */
export const PLANS_WITHOUT_PILOT_BENEFITS: readonly PlanCode[] = GRANTABLE_PLANS.filter(
  (code) => upgradeBenefits(freePlanFor(PLANS[code].audience === 'sifu' ? 'sifu' : 'student'), code).length === 0,
);

/**
 * M19 (DEFAULT M19, question 3): how much of a passport the profile shows on a plan: `basic` (the
 * current rank, the teachers with their periods, the year training began) or `full` (also the
 * examinations, forms and skills, certificates and events). Every entry is kept on every plan; a
 * lower plan only hides (DEFAULT D08).
 */
export type PassportLevel = 'basic' | 'full';
export const FULL_PASSPORT_PLANS: readonly PlanCode[] = ['premium_student', 'pro_sifu', 'federation'];

export function passportLevel(plan: PlanCode): PassportLevel {
  return FULL_PASSPORT_PLANS.includes(plan) ? 'full' : 'basic';
}
