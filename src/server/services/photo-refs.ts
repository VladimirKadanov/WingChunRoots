// Profile photo addresses and lookups (milestone M14; docs/adr/0016-profile-photos.md), apart
// from the upload (photos.ts) so the lineage reads, search and school pages attach photos to their
// public answers without the image code. Every lookup for a public answer reads v_public_person
// (app_public_ro may), which shows a photo only for a public person and only while it is active.

import { type SQL, sql } from 'drizzle-orm';

import type { PhotoDto } from '../dto/public';

/** The renditions of a photo: the squares, and (M16) the whole photo of a gallery or room photo. */
type PhotoSize = 96 | 512 | 'full';

/** The part of the content hash in a photo's address: enough to tell versions apart. */
export const PHOTO_HASH_LENGTH = 16;

/** The app's own address of one rendition: GET /api/photos/<id>/<hash>/<size>.webp. */
export function photoUrl(id: string, sha: string, size: PhotoSize): string {
  return `/api/photos/${id}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
}

/** M16: the app's own address of one rendition of a school photo: GET /api/school-photos/<id>/<hash>/<size>.webp. */
export function schoolPhotoUrl(id: string, sha: string, size: PhotoSize): string {
  return `/api/school-photos/${id}/${sha.slice(0, PHOTO_HASH_LENGTH)}/${size}.webp`;
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
