// The dashboards (milestone M08, In scope 6; plan §5.6): what a signed-in account needs first.
//   Student: "My teachers" (established links) and "My requests" (own requests to teachers).
//   Sifu:    "Student requests" (requests waiting for this teacher), the approval allowance, and
//            "My schools"; at a real limit the upgrade offer, built only from requireEntitlement()'s
//            refusal and the matrix (plan §6.5).
// Plus the account's notifications with the unread count. Personal data of the account and the
// people in its own requests only (D03: a request is visible to the people involved); never
// cached (no 'use cache': the page reads the session).

import { and, asc, count, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import { hasStaff2FA, requireUser } from '../auth/guards';
import { isStaffRole, type Principal, type StaffRole } from '../auth/principal';
import { getDb } from '../db';
import {
  lineage,
  person,
  personName,
  pilotAccessRequest,
  place,
  PUBLIC_RELATIONSHIP_STATUSES,
  type SCHOOL_STATUSES,
  school,
  schoolInstructor,
  teachingRelationship,
} from '../db/schema';
import { effectivePlan, type Executor, requireEntitlement } from '../entitlements/access';
import { feature, type Benefit, type FeatureKey, upgradeBenefits } from '../entitlements/plans';
import type { NameData } from '../templates/email/types';
import { listNotifications, type NotificationList } from './notifications';
import { INSTRUCTOR_LABELS, instructorStatus, openPilotRequest, type PilotRequestView, type PlanSummary, planSummary } from './plans';

export interface PersonRef {
  id: string;
  /** Null for a removed profile (person.deleted_at; final check, security-2). */
  slug: string | null;
  name: NameData;
  original: NameData | null;
  /** A removed profile: `name` is REMOVED_PROFILE_NAME, a UI text rather than a person's name. */
  removed: boolean;
}

/**
 * What a removed profile (person.deleted_at) shows as in the lists of the people it is linked to
 * (M08 final check, security-2): docs/data-model.md keeps its links, but anonymous. No slug, no name.
 */
export const REMOVED_PROFILE_NAME = 'A removed profile';

export type LinkBadge = 'verified' | 'arbitration' | 'under_review' | 'unconfirmed';

export interface TeacherItem {
  relationshipId: string;
  teacher: PersonRef;
  lineage: string;
  badge: LinkBadge;
  statusLabel: string;
}

export interface RequestItem extends TeacherItem {
  createdAt: string;
}

export interface StudentRequestItem {
  relationshipId: string;
  student: PersonRef;
  lineage: string;
  createdAt: string;
}

export interface SchoolItem {
  id: string;
  slug: string;
  name: string;
  city: string;
  countryCode: string;
  status: (typeof SCHOOL_STATUSES)[number];
  statusLabel: string;
  roleLabel: string;
}

/**
 * An upgrade prompt at the limit of one feature (plan §5.6). Generic over the refused feature
 * (review round 1, requirements-4): the heading and the allowance come from the matrix, so M11 can
 * build one for the public school pin with the same <UpgradePrompt>.
 */
export interface UpgradeOffer {
  feature: FeatureKey;
  /** "More students with Professional Sifu" (the feature's upgradeHeading). */
  heading: string;
  /** "You have approved 5 of 5 students on Free Sifu." (plan §5.6). */
  allowance: { current: number; limit: number; sentence: string };
  from: PlanSummary;
  to: PlanSummary;
  /** Only features with availability 'now' (plan §6.5), each with its opening note while not built. */
  benefits: Benefit[];
  /** What waits because of the limit (student requests); it stays pending and visible. */
  waiting: { count: number; sentence: string } | null;
  pilotRequest: PilotRequestView | null;
}

/** The allowance sentence and the heading of an offer at the limit of `key` (from the matrix). */
export function offerText(key: FeatureKey, current: number, limit: number, from: PlanSummary, to: PlanSummary): { heading: string; sentence: string } {
  const f = feature(key);
  const unit = f.unit ?? { one: 'use', many: 'uses', verb: 'used' };
  return {
    heading: (f.upgradeHeading ?? `More with {plan}`).replace('{plan}', to.name),
    sentence: `You have ${unit.verb} ${current} of ${limit} ${limit === 1 ? unit.one : unit.many} on ${from.name}.`,
  };
}

export interface DashboardOverview {
  accountType: 'student' | 'sifu';
  instructor: { status: 'not_instructor' | 'unverified' | 'verified'; label: string };
  plan: PlanSummary;
  until: string | null;
  hasProfile: boolean;
  /**
   * Staff accounts (review round 1, design-8): their role, whether this session proved the second
   * factor, and, for an administrator whose session did, the number of open pilot access requests,
   * which /admin/grants answers. Staff work is staff data (plan §3.2, review round 2, recheck-1):
   * before the second factor the count is null and the page asks for it first (staff accounts
   * always have two-factor authentication on: auth_user_staff_needs_2fa). Null for everyone else.
   */
  staff: { role: StaffRole; secondFactorVerified: boolean; openPilotRequests: number | null } | null;
  student: { teachers: TeacherItem[]; requests: RequestItem[] } | null;
  sifu: {
    requests: StudentRequestItem[];
    students: { approved: number; limit: number | null };
    schools: SchoolItem[];
    upgrade: UpgradeOffer | null;
  } | null;
  notifications: NotificationList;
}

const REQUEST_LABELS = {
  pending_teacher: 'Waiting for the teacher',
  awaiting_claim: 'Waiting for the teacher to join',
  under_review: 'Under review',
  rejected: 'Not confirmed: correct it and send it again',
} as const;
/** M11: the listing's status in the owner's words; the public pin is a separate question (schools.ts). */
export const SCHOOL_STATUS_LABELS = { draft: 'Draft', pending_review: 'Waiting for review', active: 'Listed', hidden: 'Hidden by a moderator', archived: 'Archived' } as const;
const SCHOOL_ROLE_LABELS = { head_instructor: 'Head instructor', instructor: 'Instructor', assistant: 'Assistant' } as const;

/**
 * The display names of people: the Latin-script primary name and the first original-script name.
 * A removed profile (deleted_at set) gets an anonymous ref: no slug, REMOVED_PROFILE_NAME and no
 * original name (final check, security-2); its names are not even read.
 */
export async function peopleRefs(ids: string[]): Promise<Map<string, PersonRef>> {
  const refs = new Map<string, PersonRef>();
  if (ids.length === 0) return refs;
  const db = getDb();
  const people = await db.select({ id: person.id, slug: person.slug, deletedAt: person.deletedAt }).from(person).where(inArray(person.id, ids));
  for (const p of people) {
    if (p.deletedAt !== null) refs.set(p.id, { id: p.id, slug: null, name: { value: REMOVED_PROFILE_NAME, lang: 'en' }, original: null, removed: true });
  }
  const shown = people.filter((p) => p.deletedAt === null);
  if (shown.length === 0) return refs;
  const names = await db
    .select({ personId: personName.personId, value: personName.value, lang: personName.lang, kind: personName.kind, isPrimary: personName.isPrimary })
    .from(personName)
    .where(inArray(personName.personId, shown.map((p) => p.id)))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  for (const p of shown) {
    const own = names.filter((n) => n.personId === p.id);
    const primary = own.find((n) => n.isPrimary);
    const original = own.find((n) => !n.isPrimary && n.kind === 'name');
    refs.set(p.id, {
      id: p.id,
      slug: p.slug,
      // Every person has a primary name (seed test, onboarding); the slug is only a last resort.
      name: primary ? { value: primary.value, lang: primary.lang } : { value: p.slug, lang: 'und-Latn' },
      original: original ? { value: original.value, lang: original.lang } : null,
      removed: false,
    });
  }
  return refs;
}

/**
 * How many student requests the approval limit holds back for this teacher (the own person): every
 * pending request, except one of a student who already counts (approving it would not grow the
 * count: withQuota's `unit`) and one of a removed profile, which waits for no one (final check,
 * security-2). Shared by the dashboard and the student requests page (M09).
 */
export async function waitingRequests(db: Executor, ownPersonId: string): Promise<number> {
  const established = db
    .select({ id: teachingRelationship.studentPersonId })
    .from(teachingRelationship)
    .where(and(eq(teachingRelationship.teacherPersonId, ownPersonId), inArray(teachingRelationship.status, [...PUBLIC_RELATIONSHIP_STATUSES])));
  const [pending] = await db
    .select({ n: count() })
    .from(teachingRelationship)
    .innerJoin(person, and(eq(person.id, teachingRelationship.studentPersonId), isNull(person.deletedAt)))
    .where(
      and(
        eq(teachingRelationship.teacherPersonId, ownPersonId),
        eq(teachingRelationship.status, 'pending_teacher'),
        notInArray(teachingRelationship.studentPersonId, established),
      ),
    );
  return pending?.n ?? 0;
}

/**
 * The approval allowance of an account and, only at a real limit where `waiting` requests wait
 * because of it (plan §5.6), the upgrade offer, built only from requireEntitlement()'s refusal and
 * the matrix (plan §6.5). Shared by the dashboard and the student requests page (M09).
 */
export async function approvalOffer(
  db: Executor,
  userId: string,
  waiting: number,
): Promise<{ approved: number; limit: number | null; upgrade: UpgradeOffer | null }> {
  const decision = await requireEntitlement({ kind: 'user', userId }, 'approve_students', { db });
  const limit = decision.limit;
  let upgrade: UpgradeOffer | null = null;
  if (!decision.ok && decision.code === 'quota' && decision.grantedBy && waiting > 0 && limit !== null) {
    const from = planSummary(decision.plan);
    const to = planSummary(decision.grantedBy);
    const text = offerText('approve_students', decision.current, limit, from, to);
    upgrade = {
      feature: 'approve_students',
      heading: text.heading,
      allowance: { current: decision.current, limit, sentence: text.sentence },
      from,
      to,
      benefits: upgradeBenefits(decision.plan, decision.grantedBy),
      // No promise of when they can be approved: only that they stay pending and visible.
      waiting: { count: waiting, sentence: waiting === 1 ? 'One student request waits below. It stays pending and visible.' : `${waiting} student requests wait below. They stay pending and visible.` },
      pilotRequest: await openPilotRequest(db, userId),
    };
  }
  return { approved: decision.current, limit, upgrade };
}

export async function dashboardOverview(principal: Principal | null): Promise<DashboardOverview> {
  const p = requireUser(principal);
  const db = getDb();
  const subject = { kind: 'user' as const, userId: p.user.id };
  const [own] = await db
    .select({ id: person.id })
    .from(person)
    .where(and(eq(person.claimedByUserId, p.user.id), isNull(person.deletedAt)));
  const effective = await effectivePlan(subject, { db });
  const status = await instructorStatus(db, p.user.id, effective.accountType);
  const notifications = await listNotifications(principal);
  let staff: DashboardOverview['staff'] = null;
  if (isStaffRole(p.user.role)) {
    let openPilotRequests: number | null = null;
    // The same check as /admin/grants and grants.list: an admin whose session proved the second factor.
    if (hasStaff2FA(p, ['admin'])) {
      const [open] = await db.select({ n: count() }).from(pilotAccessRequest).where(eq(pilotAccessRequest.status, 'open'));
      openPilotRequests = open?.n ?? 0;
    }
    staff = { role: p.user.role, secondFactorVerified: hasStaff2FA(p), openPilotRequests };
  }
  const base = {
    accountType: effective.accountType,
    instructor: { status, label: INSTRUCTOR_LABELS[status] },
    plan: planSummary(effective.plan),
    until: effective.until?.toISOString() ?? null,
    hasProfile: Boolean(own),
    staff,
    notifications,
  };

  if (effective.accountType === 'student') {
    let teachers: TeacherItem[] = [];
    let requests: RequestItem[] = [];
    if (own) {
      const rows = await db
        .select({
          id: teachingRelationship.id,
          teacherId: teachingRelationship.teacherPersonId,
          status: teachingRelationship.status,
          lineage: lineage.name,
          createdAt: teachingRelationship.createdAt,
        })
        .from(teachingRelationship)
        .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
        .where(
          and(
            eq(teachingRelationship.studentPersonId, own.id),
            inArray(teachingRelationship.status, ['verified', 'in_arbitration', 'pending_teacher', 'awaiting_claim', 'under_review', 'rejected']),
          ),
        )
        .orderBy(desc(teachingRelationship.createdAt), asc(teachingRelationship.id));
      const refs = await peopleRefs([...new Set(rows.map((r) => r.teacherId))]);
      for (const r of rows) {
        const teacher = refs.get(r.teacherId)!;
        if (r.status === 'verified' || r.status === 'in_arbitration') {
          teachers.push({
            relationshipId: r.id,
            teacher,
            lineage: r.lineage,
            badge: r.status === 'verified' ? 'verified' : 'arbitration',
            statusLabel: r.status === 'verified' ? 'Verified' : 'In arbitration',
          });
        } else {
          const s = r.status as keyof typeof REQUEST_LABELS;
          requests.push({
            relationshipId: r.id,
            teacher,
            lineage: r.lineage,
            badge: s === 'under_review' ? 'under_review' : 'unconfirmed',
            statusLabel: REQUEST_LABELS[s],
            createdAt: r.createdAt.toISOString(),
          });
        }
      }
      teachers = teachers.sort((a, b) => a.teacher.name.value.localeCompare(b.teacher.name.value, 'en'));
      requests = requests.slice(0, 50);
    }
    return { ...base, student: { teachers, requests }, sifu: null };
  }

  // Sifu.
  let requests: StudentRequestItem[] = [];
  let waiting = 0;
  let schools: SchoolItem[] = [];
  if (own) {
    const rows = await db
      .select({ id: teachingRelationship.id, studentId: teachingRelationship.studentPersonId, lineage: lineage.name, createdAt: teachingRelationship.createdAt })
      .from(teachingRelationship)
      .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
      .where(and(eq(teachingRelationship.teacherPersonId, own.id), eq(teachingRelationship.status, 'pending_teacher')))
      .orderBy(asc(teachingRelationship.createdAt), asc(teachingRelationship.id))
      .limit(50);
    waiting = await waitingRequests(db, own.id);
    const refs = await peopleRefs(rows.map((r) => r.studentId));
    requests = rows.map((r) => ({ relationshipId: r.id, student: refs.get(r.studentId)!, lineage: r.lineage, createdAt: r.createdAt.toISOString() }));
    const schoolRows = await db
      .select({
        id: school.id,
        slug: school.slug,
        name: school.name,
        city: place.name,
        countryCode: place.countryCode,
        status: school.status,
        role: schoolInstructor.role,
      })
      .from(schoolInstructor)
      .innerJoin(school, eq(school.id, schoolInstructor.schoolId))
      .innerJoin(place, eq(place.id, school.placeId))
      .where(and(eq(schoolInstructor.personId, own.id), isNull(school.deletedAt)))
      .orderBy(asc(school.name));
    schools = schoolRows.map((s) => ({
      id: s.id,
      slug: s.slug,
      name: s.name,
      city: s.city,
      countryCode: s.countryCode,
      status: s.status,
      statusLabel: SCHOOL_STATUS_LABELS[s.status],
      roleLabel: SCHOOL_ROLE_LABELS[s.role],
    }));
  }

  const { approved, limit, upgrade } = await approvalOffer(db, p.user.id, waiting);
  return { ...base, student: null, sifu: { requests, students: { approved, limit }, schools, upgrade } };
}
