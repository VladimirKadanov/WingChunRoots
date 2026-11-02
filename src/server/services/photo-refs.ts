// Profile photo addresses and lookups (milestone M14; docs/adr/0016-profile-photos.md), apart
// from the upload (photos.ts) so the lineage reads, search and school pages attach photos to their
// public answers without the image code. Every lookup for a public answer reads v_public_person
// (app_public_ro may), which shows a photo only for a public person and only while it is active.

import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';

import { getDb } from '../db';
import { person, personPhoto } from '../db/schema';
import type { LineageNodeDto, PhotoDto, StudentEntryDto, StudentsPageDto } from '../dto/public';

type PhotoSize = 96 | 512;

/** The part of the content hash in a photo's address: enough to tell versions apart. */
export const PHOTO_HASH_LENGTH = 16;

/** The app's own address of one rendition: GET /api/photos/<id>/<hash>/<size>.webp. */
export function photoUrl(id: string, sha: string, size: PhotoSize): string {
  return `/api/photos/${id}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
}

/** The DTO of a photo from its id and content hash. */
export function photoDto(id: string, sha: string): PhotoDto {
  return { small: photoUrl(id, sha, 96), large: photoUrl(id, sha, 512) };
}

/** What a person's current photo row gives: its id and content hash. */
export interface PhotoRef {
  id: string;
  sha256: string;
}

/** The DTO, or null without a photo. */
export const photoOf = (ref: PhotoRef | null | undefined): PhotoDto | null => (ref ? photoDto(ref.id, ref.sha256) : null);

/** What a query needs from a database or a transaction (the lineage reads pass their own). */
export interface SqlExecutor {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

/**
 * The current photos of these people, from v_public_person only (app_public_ro may read it): a
 * person who is not public, or whose photo was removed, has none here.
 */
export async function publicPhotoRefs(ex: SqlExecutor, ids: readonly string[]): Promise<Map<string, PhotoRef>> {
  const out = new Map<string, PhotoRef>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return out;
  const list = sql`ARRAY[${sql.join(
    unique.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;
  const result = await ex.execute(
    sql`SELECT id::text AS id, photo_id::text AS photo_id, photo_sha256 FROM v_public_person WHERE photo_id IS NOT NULL AND id = ANY (${list})`,
  );
  for (const row of result.rows as { id: string; photo_id: string; photo_sha256: string }[]) out.set(row.id, { id: row.photo_id, sha256: row.photo_sha256 });
  return out;
}

/** The current photo of the account's own person, public or not (app_rw), or null. */
export async function ownPhotoRef(personId: string): Promise<PhotoRef | null> {
  const [row] = await getDb()
    .select({ id: personPhoto.id, sha256: personPhoto.sha256 })
    .from(person)
    .innerJoin(personPhoto, and(eq(personPhoto.id, person.photoId), eq(personPhoto.personId, person.id), eq(personPhoto.status, 'active')))
    .where(and(eq(person.id, personId), isNull(person.deletedAt)));
  return row ?? null;
}


/** Sets `photo` on every person of a list (from `refs`, or null). */
export function withPhotos<T extends { id: string }>(people: readonly T[], refs: ReadonlyMap<string, PhotoRef>): (T & { photo: PhotoDto | null })[] {
  return people.map((p) => ({ ...p, photo: photoOf(refs.get(p.id)) }));
}

/** Every person id a students page names: the students, their other teachers and the own rows. */
function studentPagePeople(page: StudentsPageDto): string[] {
  return [...page.active, ...page.historical, ...page.own].flatMap((s) => [s.person.id, ...s.otherTeachers.map((t) => t.person.id)]);
}

/**
 * The photos of a lineage answer or a students page: each public person's from v_public_person
 * through `ex` (the read's own transaction, app_public_ro), and, for an answer computed for one
 * viewer, the viewer's own person's photo even while that person is not public (`own`, read with
 * app_rw by ownPhotoRef). Nobody else who is not public gets one.
 */
export async function graphPhotos<G extends { nodes: LineageNodeDto[] }>(ex: SqlExecutor, graph: G, own?: { personId: string; ref: PhotoRef | null }): Promise<G> {
  const refs = await publicPhotoRefs(ex, graph.nodes.map((n) => n.id));
  return { ...graph, nodes: graph.nodes.map((n) => ({ ...n, photo: photoOf(refs.get(n.id) ?? (own && own.personId === n.id ? own.ref : null)) })) };
}

export async function studentPhotos(ex: SqlExecutor, page: StudentsPageDto, own?: { personId: string; ref: PhotoRef | null }): Promise<StudentsPageDto> {
  const refs = await publicPhotoRefs(ex, studentPagePeople(page));
  const of = (id: string) => photoOf(refs.get(id) ?? (own && own.personId === id ? own.ref : null));
  const entry = (s: StudentEntryDto): StudentEntryDto => ({
    ...s,
    person: { ...s.person, photo: of(s.person.id) },
    otherTeachers: s.otherTeachers.map((t) => ({ ...t, person: { ...t.person, photo: of(t.person.id) } })),
  });
  return { ...page, active: page.active.map(entry), historical: page.historical.map(entry), own: page.own.map(entry) };
}
