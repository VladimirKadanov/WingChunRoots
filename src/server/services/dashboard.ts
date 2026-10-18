// The dashboards (milestone M08, In scope 6; plan §5.6): what a signed-in account needs first.
//   Student: "My teachers" (established links) and "My requests" (own requests to teachers).
//   Sifu:    "Student requests" (requests waiting for this teacher), the approval allowance, and
//            "My schools"; at a real limit the upgrade offer, built only from requireEntitlement()'s
//            refusal and the matrix (plan §6.5).
// Plus the account's notifications with the unread count. Personal data of the account and the
// people in its own requests only (D03: a request is visible to the people involved); never
// cached (no 'use cache': the page reads the session).

import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { lineage, person, personName, place, school, schoolInstructor, teachingRelationship } from '../db/schema';
import { effectivePlan, requireEntitlement } from '../entitlements/access';
import { feature, type Benefit, upgradeBenefits } from '../entitlements/plans';
import type { NameData } from '../templates/email/types';
import { listNotifications, type NotificationList } from './notifications';
import { INSTRUCTOR_LABELS, instructorStatus, myPlan, type PilotRequestView, type PlanSummary, planSummary } from './plans';

export interface PersonRef {
  id: string;
  slug: string;
  name: NameData;
  original: NameData | null;
}

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
  status: 'draft' | 'published' | 'hidden' | 'archived';
  statusLabel: string;
  roleLabel: string;
}

export interface UpgradeOffer {
  feature: 'approve_students';
  /** "You have approved 5 of 5 students on Free Sifu." (plan §5.6). */
  allowance: { current: number; limit: number; sentence: string };
  from: PlanSummary;
  to: PlanSummary;
  /** Only features with availability 'now' (plan §6.5). */
  benefits: Benefit[];
  /** Requests that wait because of the limit; they stay pending and visible. */
  waiting: number;
  pilotRequest: PilotRequestView | null;
}

export interface DashboardOverview {
  accountType: 'student' | 'sifu';
  instructor: { status: 'not_instructor' | 'unverified' | 'verified'; label: string };
  plan: PlanSummary;
  until: string | null;
  hasProfile: boolean;
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
const SCHOOL_STATUS_LABELS = { draft: 'Draft', published: 'Published', hidden: 'Hidden', archived: 'Archived' } as const;
const SCHOOL_ROLE_LABELS = { head_instructor: 'Head instructor', instructor: 'Instructor', assistant: 'Assistant' } as const;

/** The display names of people: the Latin-script primary name and the first original-script name. */
async function peopleRefs(ids: string[]): Promise<Map<string, PersonRef>> {
  const refs = new Map<string, PersonRef>();
  if (ids.length === 0) return refs;
  const db = getDb();
  const people = await db.select({ id: person.id, slug: person.slug }).from(person).where(inArray(person.id, ids));
  const names = await db
    .select({ personId: personName.personId, value: personName.value, lang: personName.lang, kind: personName.kind, isPrimary: personName.isPrimary })
    .from(personName)
    .where(inArray(personName.personId, ids))
    .orderBy(asc(personName.sortOrder), asc(personName.id));
  for (const p of people) {
    const own = names.filter((n) => n.personId === p.id);
    const primary = own.find((n) => n.isPrimary);
    const original = own.find((n) => !n.isPrimary && n.kind === 'name');
    refs.set(p.id, {
      id: p.id,
      slug: p.slug,
      // Every person has a primary name (seed test, onboarding); the slug is only a last resort.
      name: primary ? { value: primary.value, lang: primary.lang } : { value: p.slug, lang: 'und-Latn' },
      original: original ? { value: original.value, lang: original.lang } : null,
    });
  }
  return refs;
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
  const base = {
    accountType: effective.accountType,
    instructor: { status, label: INSTRUCTOR_LABELS[status] },
    plan: planSummary(effective.plan),
    until: effective.until?.toISOString() ?? null,
    hasProfile: Boolean(own),
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
  let schools: SchoolItem[] = [];
  if (own) {
    const rows = await db
      .select({ id: teachingRelationship.id, studentId: teachingRelationship.studentPersonId, lineage: lineage.name, createdAt: teachingRelationship.createdAt })
      .from(teachingRelationship)
      .innerJoin(lineage, eq(lineage.id, teachingRelationship.lineageId))
      .where(and(eq(teachingRelationship.teacherPersonId, own.id), eq(teachingRelationship.status, 'pending_teacher')))
      .orderBy(asc(teachingRelationship.createdAt), asc(teachingRelationship.id))
      .limit(50);
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

  const decision = await requireEntitlement(subject, 'approve_students', { db });
  const limit = decision.limit;
  let upgrade: UpgradeOffer | null = null;
  // Plan §5.6: only at a real limit, where a request waits because of it.
  if (!decision.ok && decision.code === 'quota' && decision.grantedBy && requests.length > 0 && limit !== null) {
    const unit = feature('approve_students').unit!;
    const from = planSummary(decision.plan);
    upgrade = {
      feature: 'approve_students',
      allowance: {
        current: decision.current,
        limit,
        sentence: `You have ${unit.verb} ${decision.current} of ${limit} ${limit === 1 ? unit.one : unit.many} on ${from.name}.`,
      },
      from,
      to: planSummary(decision.grantedBy),
      benefits: upgradeBenefits(decision.plan, decision.grantedBy),
      waiting: requests.length,
      pilotRequest: (await myPlan(principal)).pilotRequest,
    };
  }
  return { ...base, student: null, sifu: { requests, students: { approved: decision.current, limit }, schools, upgrade } };
}
