// Claim links of an organization's imported members (role replay 2026-11-25, P2-6, ADR 0074).
//
// The member import (M24, organization-import.ts) creates unclaimed, private records and never
// reads the Email column, so an imported member had no way to find and claim their record. Now an
// admin of the organization makes one claim link per imported member and passes it on themself
// (by their own e-mail, a printed sheet, a chat): WingChunRoots sends nothing.
//
//   organizationTools.claimLinks         the imported members still unclaimed, with their links
//   organizationTools.makeClaimLinks     a link for every such member who has none
//   organizationTools.replaceClaimLink   a new link for one member (the old one stops working)
//   claimLinks.get                       what a link is about (the token in the body)
//   claimLinks.accept                    a signed-in account asks to claim the record
//
// A link never signs anyone in and never makes the record theirs (Phase 3 completion condition:
// "imports cannot silently authenticate a person"): accepting opens a person_claim review case,
// exactly like a claim from a profile page (openPersonClaim), and the reviewers decide.
//
// The token: HMAC-SHA-256 of the row's id with a key derived from MAIL_SEAL_KEY (43 characters of
// base64url), so the admin can open the list again and see the same links; only its SHA-256 is
// stored, for the lookup. A used, revoked or unknown token, and one of a record no longer
// unclaimed, all answer 404, so nothing tells which tokens exist. Audit rows carry ids and counts,
// never a name.

import { createHash, createHmac } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import * as z from 'zod';

import { writeAudit } from '../audit';
import { requireUser } from '../auth/guards';
import type { Principal } from '../auth/principal';
import { getDb } from '../db';
import { uuidv7 } from '../db/ids';
import { organizationClaimLink, person, personClaim, reviewCase } from '../db/schema';
import type { Executor } from '../entitlements/access';
import { mailSealKey } from '../mail/seal';
import type { RequestMeta } from './context';
import { pgErrorOf, ServiceError } from './errors';
import { CLAIM_NOTE_MAX, claimantRefusal, CONFIRM_DOCUMENTS, openPersonClaim } from './invitations';
import { managed, requireAdministration } from './organizations';
import { fieldErrors, idempotencyKey, keyReused } from './relationships';
import { caseReplayOf, isCaseKeyConflict, lockAccountCases } from './review-core';

const NO_ORGANIZATION = 'No such organization.';
const NO_MEMBER = 'No such imported member.';
const INVALID_LINK = 'This claim link is not valid.';
const OWN_PROFILE = 'Your account already has its own profile, so it cannot claim another one. Ask the organization to check the link it gave you.';
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** The most imported members the list shows at once (an import holds at most 500 rows). */
export const CLAIM_LINKS_LIMIT = 1000;

export const claimLinksInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }) });
export const replaceClaimLinkInput = z.object({ organizationId: z.uuid({ error: NO_ORGANIZATION }), personId: z.uuid({ error: NO_MEMBER }) });
export const claimLinkTokenInput = z.object({ token: z.string().max(100) });
export const acceptClaimLinkInput = z.object({
  token: z.string().max(100),
  /** Optional, for the reviewers: anything that helps them check it is you. Never public. */
  note: z
    .string()
    .max(CLAIM_NOTE_MAX * 2, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` })
    .transform((s) => s.normalize('NFC').replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length <= CLAIM_NOTE_MAX, { error: `Use at most ${CLAIM_NOTE_MAX} characters.` })
    .nullish(),
  idempotencyKey,
});

function keyBytes(key: string): Buffer {
  return createHash('sha256').update(`wcr-claim-link:${key}`).digest();
}

/** The token of a link, from its id (the admin sees the same link every time). */
export function claimLinkToken(linkId: string, key: string = mailSealKey()): string {
  return createHmac('sha256', keyBytes(key)).update(`v1:${linkId}`).digest('base64url');
}

const hashOf = (token: string) => createHash('sha256').update(token).digest('hex');

/** The local path of a claim link. */
export const claimLinkPath = (token: string) => `/claim/${token}`;

function parse<S extends z.ZodType>(schema: S, raw: unknown, missing: string): z.output<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    if (parsed.error.issues.some((i) => i.path[0] === 'organizationId' || i.path[0] === 'personId')) throw new ServiceError('NOT_FOUND', missing);
    throw fieldErrors(parsed.error);
  }
  return parsed.data;
}

// --- The organization's side ---------------------------------------------------------------------

export interface ClaimLinkMember {
  personId: string;
  name: { value: string; lang: string };
  /** The active link, or null when none was made yet. */
  link: { path: string; createdAt: string } | null;
  /** Someone asked to claim the record and the reviewers have not decided yet. */
  claimWaiting: boolean;
}

export interface ClaimLinksView {
  organization: { id: string; name: string };
  members: ClaimLinkMember[];
  /** Members without a link yet. */
  withoutLink: number;
}

interface MemberRow extends Record<string, unknown> {
  person_id: string;
  name: string | null;
  lang: string | null;
  link_id: string | null;
  link_created_at: Date | string | null;
  claim_waiting: boolean;
}

/**
 * The members an import of this organization created whose records are still unclaimed (no
 * account, stewardship unclaimed, not deleted) and still current members.
 */
async function importedMembers(db: Executor, organizationId: string, only: readonly string[] | null = null): Promise<MemberRow[]> {
  const result = await db.execute<MemberRow>(sql`
    SELECT p.id AS person_id,
           (SELECT n.value FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS name,
           (SELECT n.lang FROM person_name n WHERE n.person_id = p.id AND n.is_primary LIMIT 1) AS lang,
           l.id AS link_id, l.created_at AS link_created_at,
           EXISTS (SELECT 1 FROM person_claim c WHERE c.person_id = p.id AND c.status = 'pending') AS claim_waiting
      FROM person p
      LEFT JOIN organization_claim_link l ON l.person_id = p.id AND l.organization_id = ${organizationId}::uuid AND l.status = 'active'
     WHERE p.deleted_at IS NULL AND p.claimed_by_user_id IS NULL AND p.stewardship = 'unclaimed'
       AND EXISTS (SELECT 1 FROM organization_import_row r JOIN organization_import i ON i.id = r.import_id
                    WHERE r.person_id = p.id AND r.status = 'imported' AND i.organization_id = ${organizationId}::uuid)
       AND EXISTS (SELECT 1 FROM organization_membership m
                    WHERE m.person_id = p.id AND m.organization_id = ${organizationId}::uuid AND (m.ends_on IS NULL OR m.ends_on >= current_date))
       ${only ? sql`AND p.id = ANY(${`{${only.join(',')}}`}::uuid[])` : sql``}
     ORDER BY name, p.id
     LIMIT ${CLAIM_LINKS_LIMIT}`);
  return result.rows;
}

const iso = (value: Date | string | null) => (value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString());

/** organizationTools.claimLinks: the organization's admins (approved, Federation), with the links. */
export async function listClaimLinks(principal: Principal | null, raw: z.input<typeof claimLinksInput>): Promise<ClaimLinksView> {
  const p = requireUser(principal);
  const input = parse(claimLinksInput, raw, NO_ORGANIZATION);
  const db = getDb();
  const { org } = await managed(db, p, input.organizationId, false);
  await requireAdministration(db, org);
  const rows = await importedMembers(db, org.id);
  const members = rows.map((r) => ({
    personId: r.person_id,
    name: { value: r.name ?? 'Unnamed member', lang: r.lang ?? 'und-Latn' },
    link: r.link_id ? { path: claimLinkPath(claimLinkToken(r.link_id)), createdAt: iso(r.link_created_at)! } : null,
    claimWaiting: r.claim_waiting,
  }));
  return { organization: { id: org.id, name: org.name }, members, withoutLink: members.filter((m) => m.link === null).length };
}

async function insertLink(tx: Executor, organizationId: string, personId: string, userId: string): Promise<string> {
  const id = uuidv7();
  await tx.insert(organizationClaimLink).values({ id, organizationId, personId, tokenHash: hashOf(claimLinkToken(id)), createdByUserId: userId });
  return id;
}

/** organizationTools.makeClaimLinks: a link for every imported, unclaimed member without one. */
export async function makeClaimLinks(principal: Principal | null, raw: z.input<typeof claimLinksInput>, meta: RequestMeta): Promise<{ made: number }> {
  const p = requireUser(principal);
  const input = parse(claimLinksInput, raw, NO_ORGANIZATION);
  return getDb().transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await requireAdministration(tx, org);
    const without = (await importedMembers(tx, org.id)).filter((r) => r.link_id === null);
    for (const row of without) await insertLink(tx, org.id, row.person_id, p.user.id);
    if (without.length > 0) {
      await writeAudit(tx, {
        action: 'organization.claim_links',
        actorUserId: p.user.id,
        actorRole: p.user.role,
        subjectType: 'organization',
        subjectId: org.id,
        after: { made: without.length },
        requestId: meta.requestId,
        ipHmac: meta.ipHmac,
      });
    }
    return { made: without.length };
  });
}

/** organizationTools.replaceClaimLink: a new link for one member; the old one stops working. */
export async function replaceClaimLink(principal: Principal | null, raw: z.input<typeof replaceClaimLinkInput>, meta: RequestMeta): Promise<{ personId: string; path: string }> {
  const p = requireUser(principal);
  const input = parse(replaceClaimLinkInput, raw, NO_MEMBER);
  return getDb().transaction(async (tx) => {
    const { org } = await managed(tx, p, input.organizationId);
    await requireAdministration(tx, org);
    const [row] = await importedMembers(tx, org.id, [input.personId]);
    if (!row) throw new ServiceError('NOT_FOUND', NO_MEMBER);
    await tx
      .update(organizationClaimLink)
      .set({ status: 'revoked', updatedAt: new Date() })
      .where(and(eq(organizationClaimLink.personId, row.person_id), eq(organizationClaimLink.status, 'active')));
    const id = await insertLink(tx, org.id, row.person_id, p.user.id);
    await writeAudit(tx, {
      action: 'organization.claim_link_replace',
      actorUserId: p.user.id,
      actorRole: p.user.role,
      subjectType: 'organization_claim_link',
      subjectId: id,
      after: { organizationId: org.id, personId: row.person_id },
      requestId: meta.requestId,
      ipHmac: meta.ipHmac,
    });
    return { personId: row.person_id, path: claimLinkPath(claimLinkToken(id)) };
  });
}

// --- The member's side ---------------------------------------------------------------------------

interface LinkRow {
  id: string;
  organizationId: string;
  personId: string;
  status: 'active' | 'used' | 'revoked';
  usedByUserId: string | null;
}

async function linkByToken(db: Executor, token: string, lock = false): Promise<LinkRow | null> {
  if (!TOKEN.test(token)) return null;
  const query = db
    .select({
      id: organizationClaimLink.id,
      organizationId: organizationClaimLink.organizationId,
      personId: organizationClaimLink.personId,
      status: organizationClaimLink.status,
      usedByUserId: organizationClaimLink.usedByUserId,
    })
    .from(organizationClaimLink)
    .where(eq(organizationClaimLink.tokenHash, hashOf(token)));
  const [row] = lock ? await query.for('update') : await query;
  return row ?? null;
}

export interface ClaimLinkView {
  /** open: the record can be claimed; yours: this account asked to claim it with this link. */
  state: 'open' | 'yours';
  organizationName: string;
  name: { value: string; lang: string };
  viewer: {
    signedIn: boolean;
    /** Why this account cannot claim now, in words; null when it can (or is not signed in). */
    refusal: string | null;
    confirmDocuments: boolean;
    caseId: string | null;
    claimStatus: 'pending' | 'approved' | 'rejected' | 'withdrawn' | null;
  };
}

async function recordOf(db: Executor, personId: string) {
  const [row] = await db
    .select({ claimedBy: person.claimedByUserId, deletedAt: person.deletedAt, stewardship: person.stewardship })
    .from(person)
    .where(eq(person.id, personId));
  return row ?? null;
}

/** claims.get of a claim link: anyone who holds the link; 404 for anything that is not open (or theirs). */
export async function getClaimLink(principal: Principal | null, raw: z.input<typeof claimLinkTokenInput>): Promise<ClaimLinkView> {
  const parsed = claimLinkTokenInput.safeParse(raw);
  const db = getDb();
  const link = parsed.success ? await linkByToken(db, parsed.data.token) : null;
  if (!link) throw new ServiceError('NOT_FOUND', INVALID_LINK);
  const viewerId = principal?.user.id ?? null;
  const yours = link.status === 'used' && viewerId !== null && link.usedByUserId === viewerId;
  const record = await recordOf(db, link.personId);
  const open = link.status === 'active' && record !== null && !record.deletedAt && !record.claimedBy && record.stewardship === 'unclaimed';
  if (!open && !yours) throw new ServiceError('NOT_FOUND', INVALID_LINK);
  const [names] = (
    await db.execute<{ org: string; name: string | null; lang: string | null }>(sql`
      SELECT o.name AS org,
             (SELECT n.value FROM person_name n WHERE n.person_id = ${link.personId}::uuid AND n.is_primary LIMIT 1) AS name,
             (SELECT n.lang FROM person_name n WHERE n.person_id = ${link.personId}::uuid AND n.is_primary LIMIT 1) AS lang
        FROM organization o WHERE o.id = ${link.organizationId}::uuid`)
  ).rows;
  const [claim] =
    yours && viewerId
      ? await db
          .select({ id: reviewCase.id, status: personClaim.status })
          .from(reviewCase)
          .leftJoin(personClaim, eq(personClaim.reviewCaseId, reviewCase.id))
          .where(and(eq(reviewCase.personId, link.personId), eq(reviewCase.kind, 'person_claim'), eq(reviewCase.openedByUserId, viewerId)))
          .orderBy(sql`${reviewCase.createdAt} DESC`)
          .limit(1)
      : [];
  const refusal = principal && open ? await claimantRefusal(db, principal, OWN_PROFILE) : null;
  return {
    state: yours ? 'yours' : 'open',
    organizationName: names?.org ?? 'The organization',
    name: { value: names?.name ?? 'Unnamed member', lang: names?.lang ?? 'und-Latn' },
    viewer: {
      signedIn: principal !== null,
      refusal: refusal?.message ?? null,
      confirmDocuments: refusal?.message === CONFIRM_DOCUMENTS,
      caseId: claim?.id ?? null,
      claimStatus: (claim?.status as ClaimLinkView['viewer']['claimStatus']) ?? null,
    },
  };
}

/**
 * claimLinks.accept: the signed-in account asks to claim the record of the link. In one
 * transaction: the account's case lock, a replayed key, the link and the record FOR UPDATE, the
 * account's checks, then the claim's writes (openPersonClaim: a review case the reviewers decide).
 * The link is then used: it opens nothing for anyone else.
 */
export async function acceptClaimLink(principal: Principal | null, raw: z.input<typeof acceptClaimLinkInput>, meta: RequestMeta): Promise<{ caseId: string; replayed: boolean }> {
  const p = requireUser(principal);
  const parsed = acceptClaimLinkInput.safeParse(raw);
  if (!parsed.success) throw fieldErrors(parsed.error);
  const input = parsed.data;
  try {
    return await getDb().transaction(async (tx) => {
      await lockAccountCases(tx, p.user.id);
      const link = await linkByToken(tx, input.token, true);
      if (!link) throw new ServiceError('NOT_FOUND', INVALID_LINK);
      const replay = await caseReplayOf(tx, p.user.id, input.idempotencyKey);
      if (replay) {
        const [earlier] = await tx.select({ kind: reviewCase.kind, personId: reviewCase.personId }).from(reviewCase).where(eq(reviewCase.id, replay.caseId));
        if (replay.action !== 'open' || earlier?.kind !== 'person_claim' || earlier.personId !== link.personId) throw keyReused();
        return { caseId: replay.caseId, replayed: true };
      }
      if (link.status === 'used' && link.usedByUserId === p.user.id) throw new ServiceError('CONFLICT', 'You have used this claim link already.');
      if (link.status !== 'active') throw new ServiceError('NOT_FOUND', INVALID_LINK);
      const [record] = await tx
        .select({ claimedBy: person.claimedByUserId, deletedAt: person.deletedAt, stewardship: person.stewardship })
        .from(person)
        .where(and(eq(person.id, link.personId), isNull(person.deletedAt)))
        .for('update');
      if (!record || record.claimedBy || record.stewardship !== 'unclaimed') throw new ServiceError('NOT_FOUND', INVALID_LINK);
      const refusal = await claimantRefusal(tx, p, OWN_PROFILE);
      if (refusal) throw new ServiceError('CONFLICT', refusal.message);
      const caseId = await openPersonClaim(
        tx,
        p,
        { personId: link.personId, relationshipId: null, note: input.note ?? null, key: input.idempotencyKey, after: { source: 'organization_claim_link', organizationId: link.organizationId, claimLinkId: link.id } },
        meta,
      );
      await tx.update(organizationClaimLink).set({ status: 'used', usedAt: new Date(), usedByUserId: p.user.id, updatedAt: new Date() }).where(eq(organizationClaimLink.id, link.id));
      return { caseId, replayed: false };
    });
  } catch (error) {
    if (isCaseKeyConflict(error)) throw keyReused();
    const pg = pgErrorOf(error);
    if (pg?.code === '23505' && pg.constraint === 'person_claim_one_pending_key') throw new ServiceError('CONFLICT', 'You already have a profile claim waiting for the reviewers.');
    throw error;
  }
}
