// Evidence files and historical claims for the E2E tests (milestone M10a): fictional PDFs generated
// in memory, uploads through POST /api/evidence/upload with the page's session (as the evidence
// field sends a file), and a claim through relationships.requestHistorical. Used by
// e2e/m10a-evidence.spec.ts and the screen states of e2e/screenshots.spec.ts. Fictional data only
// (D20): `Demo …` names, filler text, nothing read from disk.

import { randomBytes, randomUUID } from 'node:crypto';

import { expect, type Page } from '@playwright/test';
import { sql } from 'drizzle-orm';

import { getDb } from '../../src/server/db';
import { BASE_URL } from './auth';
import { apiPost } from './plans';

/** The demo lineage the claims of the tests belong to. */
export const CLAIM_LINEAGE = 'Demo Lineage C';

/** Letters only, so a name stays a Latin-script name; unique enough to find one person. */
export function letters(length = 6): string {
  return Array.from(randomBytes(length), (byte) => String.fromCharCode(97 + (byte % 26))).join('');
}

/** A fictional PDF of `size` bytes: a header, filler comment lines and the end marker. */
export function fictionalPdf(size: number, seed = letters()): Buffer {
  const head = `%PDF-1.4\n% Demo evidence ${seed}: invented for the WingChunRoots tests.\n`;
  const tail = '\n%%EOF\n';
  const out = Buffer.alloc(Math.max(size, head.length + tail.length), '% demo filler line of a fictional document.\n');
  out.write(head, 0, 'latin1');
  out.write(tail, out.length - tail.length, 'latin1');
  return out;
}

/** POST /api/evidence/upload with the page's session, the file itself as the body. */
export function uploadEvidence(page: Page, bytes: Buffer, name = 'demo-evidence.pdf') {
  return page.request.post('/api/evidence/upload', {
    data: bytes,
    headers: { origin: BASE_URL, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
  });
}

export async function lineageIdOf(name: string): Promise<string> {
  const rows = await getDb().execute<{ id: string }>(sql`SELECT id::text AS id FROM lineage WHERE name = ${name}`);
  return rows.rows[0]!.id;
}

/** The review case of a claim's relationship. */
export async function caseOf(relationshipId: string): Promise<{ id: string; status: string }> {
  const rows = await getDb().execute<{ id: string; status: string }>(sql`SELECT id::text AS id, status FROM review_case WHERE relationship_id = ${relationshipId}::uuid`);
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0]!;
}

/**
 * A claim of the page's account about a new historical teacher through the API, with one PDF
 * uploaded first. The account needs a profile (onboarding).
 */
export async function claimThroughApi(page: Page, teacherName: string): Promise<{ relationshipId: string; fileId: string; caseId: string }> {
  const uploaded = await uploadEvidence(page, fictionalPdf(20_000), 'demo-certificate.pdf');
  expect(uploaded.status(), await uploaded.text()).toBe(201);
  const fileId = ((await uploaded.json()) as { evidence: { id: string } }).evidence.id;
  const claimed = await apiPost(page, '/relationships/request-historical', {
    teacherName,
    lifeStatus: 'deceased',
    lineageId: await lineageIdOf(CLAIM_LINEAGE),
    periods: [{ from: '1979', to: '1990', ongoing: false }],
    note: 'A fictional certificate of the demo data.',
    evidenceIds: [fileId],
    idempotencyKey: randomUUID(),
  });
  expect(claimed.status(), await claimed.text()).toBe(200);
  const relationshipId = ((await claimed.json()) as { relationship: { id: string } }).relationship.id;
  return { relationshipId, fileId, caseId: (await caseOf(relationshipId)).id };
}
