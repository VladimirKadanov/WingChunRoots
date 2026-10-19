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
 * docs/entitlements.md. The version is shown on /plans and returned by the API (plans.catalog).
 */
export const PLAN_MATRIX_VERSION = '2026-10-19.1';
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
    summary: 'A full training passport, media and event notifications, once they arrive.',
  },
  free_sifu: {
    code: 'free_sifu',
    tier: 'Tier 1-B',
    name: 'Free Sifu',
    audience: 'sifu',
    rank: 0,
    availability: 'now',
    price: proposal(0),
    summary: 'Your identity and lineage as an instructor, with up to five approved students.',
  },
  pro_sifu: {
    code: 'pro_sifu',
    tier: 'Tier 3',
    name: 'Professional Sifu',
    audience: 'sifu',
    rank: 1,
    availability: 'now',
    price: proposal(19),
    summary: 'Student administration without the five-student limit and a public pin for your school.',
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
   * photos and videos (D07) it is recorded and not enforced in Phase 1.
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
   * Enforced on the server in Phase 1 (plan §6.5): only the five approved students of Free Sifu
   * (D06) and the public school pin of Professional Sifu (from M11).
   */
  enforced: boolean;
  /**
   * For a feature of the pilot (availability 'now') whose screens are not built yet: when it opens,
   * in the words the app shows beside it ("Opens with teacher requests"). An upgrade prompt and
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
    availability: 'planned',
    phase: 2,
    enforced: false,
    unit: { one: 'photo', many: 'photos', verb: 'added' },
    // DEFAULT D07: recorded here, enforced with the media of Phase 2.
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
    opens: 'Opens with teacher requests',
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
    opens: 'Opens with teacher requests',
    unit: { one: 'student', many: 'students', verb: 'approved' },
    upgradeHeading: 'More students with {plan}',
    // DEFAULT D06: up to 5 approved students on Free Sifu; "unlimited" means no limit in the pilot.
    values: {
      free_student: quota('No', 'Not included', 0),
      premium_student: quota('No', 'Not included', 0),
      free_sifu: quota('Up to 5', 'Up to 5 students', 5),
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
    opens: 'Opens with schools and the map',
    note: 'When the map opens, anyone will be able to browse it. A public pin for a school will need an instructor with Professional Sifu.',
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
    label: 'School schedule and business profile',
    availability: 'planned',
    phase: 2,
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
    key: 'passport',
    source: 'Digital passport',
    label: 'Training passport',
    availability: 'planned',
    phase: 2,
    enforced: false,
    values: {
      free_student: text('Basic'),
      premium_student: text('Full timeline'),
      free_sifu: text('Basic instructor record'),
      pro_sifu: text('Full instructor record'),
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
    availability: 'planned',
    phase: 2,
    enforced: false,
    values: {
      free_student: text('Browse'),
      premium_student: text('Browse and notifications'),
      free_sifu: text('No publishing entitlement', 'No publishing', false),
      pro_sifu: { source: 'Up to 2 events per month', label: 'Up to 2 events a month', included: true, limit: 2 },
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
 * Premium Student unlocks nothing yet in Phase 1: every feature where it gives more than Free
 * Student is planned (see PLANS_WITHOUT_PILOT_BENEFITS). It stays grantable so pilot testers keep
 * it when its features arrive; the grant form and the admin guide say so (review round 1,
 * requirements-2).
 */
export const GRANTABLE_PLANS: readonly PlanCode[] = ['premium_student', 'pro_sifu'];

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
 * The real benefits of moving from one plan to another (plan §5.6): only features with
 * availability 'now', where `to` gives more. Planned features never appear here; a feature of the
 * pilot that is not built yet carries `opens`, which the prompt shows beside it.
 */
export function upgradeBenefits(from: PlanCode, to: PlanCode): Benefit[] {
  return FEATURES.filter((f) => f.availability === 'now' && improves(f, from, to)).map((f) => ({
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
