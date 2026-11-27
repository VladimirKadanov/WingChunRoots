// account.export (review 2026-11-13, privacy finding 3; owner decision 2026-11-27,
// docs/adr/0088-review-1113-leftovers.md): "Download my data" on /account/privacy. One JSON file of
// what the platform keeps about the signed-in account and its own profile, so the privacy notice's
// "receive a copy" (section 8) works without anyone running SQL by hand. Also GET /api/v1/account/export
// for the future app (plan §6.8).
//
// What it holds: the account (address, type, role, time zone, dates), its sessions (times and the
// browser's name only), consents, notification settings, its own profile (names in every script,
// biography, place, links, videos, photo list), its teacher and student links (the other person's
// display name and the link's state), passport entries, events it attends or organizes, schools it
// lists, organizations it administers or is a member of, trial-lesson requests it sent, requests
// it opened with the team, invitations it sent, people it follows, plans and subscriptions, its
// notices and the e-mails sent to it (template and time).
//
// What it leaves out, on purpose: secrets (password hash, second-factor secret and backup codes,
// session tokens, the IP HMAC), other people's private data (an invitee's address, a school
// sender's contact, review notes and evidence of staff), files themselves (photos and certificates
// are listed; they can be downloaded from their pages) and the exact pin of a school.
//
// Audited as account.export (no content, only that it happened). Read in one repeatable-read snapshot.

import { sql } from 'drizzle-orm';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import type { RequestMeta } from './context';
import { ServiceError } from './errors';

export const ACCOUNT_EXPORT_FORMAT = 'wingchunroots-account-export/1';

type Row = Record<string, unknown>;

export interface AccountExport {
  format: typeof ACCOUNT_EXPORT_FORMAT;
  exportedAt: string;
  /** What the file is and what it leaves out, in a sentence each. */
  about: string[];
  account: Row;
  sessions: Row[];
  consents: Row[];
  notificationSettings: Row[];
  profile: {
    person: Row;
    names: Row[];
    biographies: Row[];
    links: Row[];
    videos: Row[];
    photos: Row[];
  } | null;
  teachingLinks: Row[];
  passport: {
    ranks: Row[];
    exams: Row[];
    skills: Row[];
    certificates: Row[];
    attendance: Row[];
  };
  eventsOrganized: Row[];
  schoolsListed: Row[];
  organizationsAdministered: Row[];
  organizationMemberships: Row[];
  trialLessonRequests: Row[];
  requestsToTheTeam: Row[];
  invitationsSent: Row[];
  /** Review 2026-11-13 (ADR 0088): requests the account made to name someone, and requests naming its person. */
  namingRequests: Row[];
  following: Row[];
  plans: Row[];
  subscriptions: Row[];
  notices: Row[];
  emails: Row[];
}

/** Rows as plain JSON: dates as ISO 8601, everything else as the database gave it. */
function plain(rows: Row[]): Row[] {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
}

const ABOUT = [
  'Everything WingChunRoots keeps about your account and your own profile, as of exportedAt.',
  'Passwords, second-factor secrets, session tokens and the hashed network address are never exported.',
  "Other people's private details (an invitee's e-mail, a school's private contact, staff notes) are left out.",
  'Photos and certificates are listed here; download the files from their pages.',
];

/** account.export: the signed-in account's own data as one JSON document. */
export async function exportAccountData(principal: Principal | null, meta: RequestMeta): Promise<AccountExport> {
  const p = requireUser(principal);
  const uid = p.user.id;
  return getDb().transaction(
    async (tx) => {
      const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => plain((await tx.execute<Row>(query)).rows);
      const [account] = await q(sql`
        SELECT u.id, u.email, u.email_verified, u.name, u.role, u.account_type, u.timezone, u.two_factor_enabled,
               u.created_at, u.last_active_at
          FROM auth_user u WHERE u.id = ${uid}::uuid`);
      if (!account) throw new ServiceError('UNAUTHORIZED', 'Sign in to continue.');
      const sessions = await q(sql`
        SELECT s.created_at, s.expires_at, s.user_agent, s.two_factor_verified_at
          FROM auth_session s WHERE s.user_id = ${uid}::uuid ORDER BY s.created_at DESC`);
      const consents = await q(sql`
        SELECT c.kind, c.document_version, c.action, c.occurred_at
          FROM consent_record c WHERE c.user_id = ${uid}::uuid ORDER BY c.occurred_at, c.id`);
      const notificationSettings = await q(sql`
        SELECT n.category, n.email, n.updated_at FROM notification_preference n WHERE n.user_id = ${uid}::uuid ORDER BY n.category`);

      const [own] = await q(sql`
        SELECT pe.id, pe.slug, pe.kind, pe.life_status, pe.stewardship, pe.visibility, pe.country_code, pe.birth_date,
               pl.name AS city, pe.training_start_year, pe.era_text, pe.new_to_wing_chun, pe.school_listing,
               pe.supporter_badge, pe.taken_down_at, pe.created_at, pe.updated_at
          FROM person pe LEFT JOIN place pl ON pl.id = pe.place_id
         WHERE pe.claimed_by_user_id = ${uid}::uuid AND pe.deleted_at IS NULL`);
      const personId = (own?.id as string | undefined) ?? null;
      const ofPerson = async (query: ReturnType<typeof sql>) => (personId ? q(query) : []);

      const profile = own
        ? {
            person: own,
            names: await q(sql`
              SELECT n.kind, n.value, n.script, n.lang, n.romanization, n.is_primary, n.created_at
                FROM person_name n WHERE n.person_id = ${personId}::uuid ORDER BY n.sort_order, n.created_at`),
            biographies: await q(sql`SELECT b.lang, b.body, b.updated_at FROM person_bio b WHERE b.person_id = ${personId}::uuid`),
            links: await q(sql`SELECT l.label, l.url, l.position FROM person_link l WHERE l.person_id = ${personId}::uuid ORDER BY l.position`),
            videos: await q(sql`SELECT v.provider, v.video_id, v.title, v.position FROM person_video v WHERE v.person_id = ${personId}::uuid ORDER BY v.position`),
            photos: await q(sql`
              SELECT ph.id, ph.status, ph.caption, ph.width, ph.height, ph.size_bytes, ph.created_at, ph.removed_at
                FROM person_photo ph WHERE ph.person_id = ${personId}::uuid ORDER BY ph.created_at`),
          }
        : null;

      const teachingLinks = await ofPerson(sql`
        SELECT CASE WHEN r.teacher_person_id = ${personId}::uuid THEN 'teacher' ELSE 'student' END AS your_role,
               (SELECT n.value FROM person_name n
                 WHERE n.person_id = CASE WHEN r.teacher_person_id = ${personId}::uuid THEN r.student_person_id ELSE r.teacher_person_id END
                   AND n.is_primary LIMIT 1) AS other_person,
               r.status, r.visibility, r.verification_path, r.certainty, r.request_note, r.confirmed_at, r.created_at, r.updated_at
          FROM teaching_relationship r
         WHERE r.teacher_person_id = ${personId}::uuid OR r.student_person_id = ${personId}::uuid
         ORDER BY r.created_at`);

      // Table and column names are constants of this file; the person id is a parameter.
      const passportBase = (table: string, columns: string) =>
        ofPerson(sql`SELECT ${sql.raw(columns)}, e.visibility, e.status, e.created_at, e.withdrawn_at, e.removed_at
                       FROM ${sql.raw(table)} e WHERE e.person_id = ${personId}::uuid ORDER BY e.created_at`);
      const passport = {
        ranks: await passportBase('passport_rank', `e.rank, e.awarded_on, e.precision, (SELECT o.name FROM organization o WHERE o.id = e.organization_id) AS organization`),
        exams: await passportBase('passport_exam', `e.exam_on, e.precision, e.awarded_rank, (SELECT o.name FROM organization o WHERE o.id = e.organization_id) AS organization`),
        skills: await passportBase('passport_skill', 'e.name, e.progress, e.since_on, e.precision'),
        certificates: await passportBase('passport_certificate', 'e.title, e.issued_on, e.precision, e.width, e.height, e.size_bytes'),
        attendance: await passportBase('event_attendance', `(SELECT ev.title FROM event ev WHERE ev.id = e.event_id) AS event, e.claimed`),
      };

      const eventsOrganized = await q(sql`
        SELECT ev.slug, ev.title, ev.kind, ev.starts_at, ev.ends_at, ev.timezone, ev.online, ev.status, ev.created_at
          FROM event ev WHERE ev.organizer_user_id = ${uid}::uuid OR ev.created_by_user_id = ${uid}::uuid ORDER BY ev.starts_at`);
      const schoolsListed = await q(sql`
        SELECT s.slug, s.name, pl.name AS city, s.address_line, s.status, s.location_privacy, s.contact_email, s.contact_phone,
               s.website_url, s.created_at, s.deleted_at
          FROM school s LEFT JOIN place pl ON pl.id = s.place_id WHERE s.created_by_user_id = ${uid}::uuid ORDER BY s.created_at`);
      const organizationsAdministered = await q(sql`
        SELECT o.slug, o.name, a.role, a.created_at AS since, a.revoked_at
          FROM organization_admin a JOIN organization o ON o.id = a.organization_id WHERE a.user_id = ${uid}::uuid ORDER BY a.created_at`);
      const organizationMemberships = await ofPerson(sql`
        SELECT o.slug, o.name, m.role, m.starts_on, m.ends_on, m.created_at
          FROM organization_membership m JOIN organization o ON o.id = m.organization_id WHERE m.person_id = ${personId}::uuid ORDER BY m.created_at`);
      const trialLessonRequests = await q(sql`
        SELECT (SELECT s.name FROM school s WHERE s.id = t.school_id) AS school, t.sender_name, t.contact_method, t.contact_value,
               t.preferred_times, t.message, t.status, t.reply, t.created_at, t.closed_at, t.scrubbed_at
          FROM trial_inquiry t WHERE t.sender_user_id = ${uid}::uuid ORDER BY t.created_at`);
      const requestsToTheTeam = await q(sql`
        SELECT c.kind, c.status, c.resolution, c.created_at, c.resolved_at
          FROM review_case c WHERE c.opened_by_user_id = ${uid}::uuid ORDER BY c.created_at`);
      const invitationsSent = await q(sql`
        SELECT (SELECT n.value FROM person_name n WHERE n.person_id = i.person_id AND n.is_primary LIMIT 1) AS invited_person,
               i.status, i.created_at, i.expires_at, i.accepted_at
          FROM invitation i WHERE i.invited_by_user_id = ${uid}::uuid ORDER BY i.created_at`);
      const namingRequests = await q(sql`
        SELECT r.kind, r.status, r.created_at, r.expires_at, (r.asked_by_user_id = ${uid}::uuid) AS asked_by_you
          FROM naming_request r
         WHERE r.asked_by_user_id = ${uid}::uuid
            OR r.person_id IN (SELECT pe.id FROM person pe WHERE pe.claimed_by_user_id = ${uid}::uuid)
         ORDER BY r.created_at`);
      const following = await q(sql`
        SELECT pe.slug, (SELECT n.value FROM person_name n WHERE n.person_id = f.person_id AND n.is_primary LIMIT 1) AS name, f.created_at
          FROM person_follow f JOIN person pe ON pe.id = f.person_id WHERE f.follower_user_id = ${uid}::uuid ORDER BY f.created_at`);
      const plans = await q(sql`
        SELECT g.plan_code, g.source, g.starts_at, g.ends_at, g.revoked_at
          FROM entitlement_grant g WHERE g.subject_user_id = ${uid}::uuid ORDER BY g.starts_at`);
      const subscriptions = await q(sql`
        SELECT b.provider, b.plan_code, b.interval, b.status, b.cancel_at_period_end, b.current_period_start, b.current_period_end, b.ended_at, b.created_at
          FROM billing_subscription b WHERE b.subject_user_id = ${uid}::uuid ORDER BY b.created_at`);
      const notices = await q(sql`
        SELECT n.template, n.payload, n.read_at, n.created_at FROM notification n WHERE n.user_id = ${uid}::uuid ORDER BY n.created_at`);
      const emails = await q(sql`
        SELECT e.template, e.status, e.sent_at, e.created_at FROM email_delivery e WHERE e.user_id = ${uid}::uuid ORDER BY e.created_at`);

      await writeAudit(tx, {
        action: 'account.export',
        actorUserId: uid,
        actorRole: p.user.role,
        subjectType: 'user',
        subjectId: uid,
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });

      return {
        format: ACCOUNT_EXPORT_FORMAT,
        exportedAt: new Date().toISOString(),
        about: ABOUT,
        account,
        sessions,
        consents,
        notificationSettings,
        profile,
        teachingLinks,
        passport,
        eventsOrganized,
        schoolsListed,
        organizationsAdministered,
        organizationMemberships,
        trialLessonRequests,
        requestsToTheTeam,
        invitationsSent,
        namingRequests,
        following,
        plans,
        subscriptions,
        notices,
        emails,
      };
    },
    { isolationLevel: 'repeatable read', accessMode: 'read write' },
  );
}
