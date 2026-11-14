// The object families of the archive (review 2026-11-13, ops.md H1; docs/operations/backup-and-restore.md):
// every kind of file the database points at in an object store, which store holds it, which rows
// have files right now, and what scripts/ops/evidence-objects.ts has to copy, verify and put back.
//
// Why a registry: M12 copied only `evidence_file` objects. Profile and gallery photos, school photos
// and logos, event posters (the media store) and passport certificates (the private store, key
// prefix `certificates/`) arrived in M14 to M19 and the backup was never extended, so a restore
// brought back every row and none of those files. A table that holds a storage key and is not in
// OBJECT_FAMILIES (or, with a reason, in NOT_OBJECT_COLUMNS) fails scripts/lib/object-families.test.ts.
//
// No storage key, name or content is printed by anything built on this file (CLAUDE.md §6).

export type StoreName = 'evidence' | 'media';

export interface ObjectFamily {
  /** Short, stable name: the first field of a row line and the label in the drill's summary. */
  id: 'evidence' | 'certificate' | 'person_photo' | 'school_photo' | 'event_poster';
  /** The table and column that hold the storage key (scripts/lib/object-families.test.ts matches them against the schema). */
  table: string;
  column: string;
  /** `evidence`: the private store (getEvidenceStore); `media`: the photo store (getPhotoStore). */
  store: StoreName;
  /**
   * Which stored object carries the row's SHA-256: `-` the key itself (evidence); `512` or `full`
   * the rendition under `<key>/…` (photos are addressed by their 512 px square, posters and
   * certificates by the whole image).
   */
  hashed: '-' | '512' | 'full';
  /** The prefix of the keys (`evidence/<48 hex>`); no two families of different stores share one, so an archive keeps every key as a path. */
  prefix: 'evidence' | 'certificates' | 'photos';
  /**
   * A SELECT of one text column, `<id>|<storage key>|<sha256>|<mime>|<parts>` per row that has
   * files right now (rows whose files were deleted are not listed): `parts` is `-` for the key
   * itself or the renditions `96,512,full` (a photo of M14 and a school logo have no `full`).
   * `{where}` is replaced by the live filter and an extra condition when a sample is taken.
   */
  select: string;
}

export const WEBP = 'image/webp';

/** The columns `parts` lists, as a SQL CASE on the row (full_width is null for a photo stored before M16 and for a logo). */
const RENDITIONS = "CASE WHEN full_width IS NULL THEN '96,512' ELSE '96,512,full' END";

/**
 * Every object family. The rule for "has files right now" follows the services that delete files:
 * a replaced or removed photo, a withdrawn or removed certificate, a removed event (its poster
 * columns are cleared) and a deleted evidence file keep their rows and lose their files.
 */
export const OBJECT_FAMILIES: readonly ObjectFamily[] = [
  {
    id: 'evidence',
    table: 'evidence_file',
    column: 'storage_key',
    store: 'evidence',
    hashed: '-',
    prefix: 'evidence',
    select: "SELECT 'evidence|' || id || '|' || storage_key || '|' || sha256 || '|' || mime || '|-' AS line FROM evidence_file WHERE deleted_at IS NULL",
  },
  {
    id: 'certificate',
    table: 'passport_certificate',
    column: 'storage_key',
    store: 'evidence',
    hashed: 'full',
    prefix: 'certificates',
    select: `SELECT 'certificate|' || id || '|' || storage_key || '|' || sha256 || '|${WEBP}|96,512,full' AS line FROM passport_certificate WHERE status = 'active'`,
  },
  {
    id: 'person_photo',
    table: 'person_photo',
    column: 'storage_key',
    store: 'media',
    hashed: '512',
    prefix: 'photos',
    select: `SELECT 'person_photo|' || id || '|' || storage_key || '|' || sha256 || '|${WEBP}|' || (${RENDITIONS}) AS line FROM person_photo WHERE status IN ('active', 'gallery')`,
  },
  {
    id: 'school_photo',
    table: 'school_photo',
    column: 'storage_key',
    store: 'media',
    hashed: '512',
    prefix: 'photos',
    select: `SELECT 'school_photo|' || id || '|' || storage_key || '|' || sha256 || '|${WEBP}|' || (${RENDITIONS}) AS line FROM school_photo WHERE status = 'active'`,
  },
  {
    id: 'event_poster',
    table: 'event',
    column: 'poster_storage_key',
    store: 'media',
    hashed: 'full',
    prefix: 'photos',
    select: `SELECT 'event_poster|' || id || '|' || poster_storage_key || '|' || poster_sha256 || '|${WEBP}|96,512,full' AS line FROM event WHERE poster_storage_key IS NOT NULL AND poster_sha256 IS NOT NULL`,
  },
] as const;

/**
 * Columns the coverage test finds by name (storage, object, bucket, blob, a key of a file or photo)
 * that are not objects of a store, each with its reason. A new column that looks like a storage key
 * has to be an OBJECT_FAMILIES row or be listed here: the archive must never silently skip one.
 */
export const NOT_OBJECT_COLUMNS: readonly { table: string; column: string; reason: string }[] = [
  { table: 'billing_event', column: 'object_id', reason: "the payment provider's own object id, not a stored file" },
];

/**
 * Whether a column's name says "a stored object": a storage key, an object, a bucket, a blob, S3, or
 * the key of a file, photo, poster or logo. The coverage tests (unit, over the Drizzle schema, and
 * integration, over the migrated database) find the candidates with it.
 */
export function looksLikeObjectColumn(name: string): boolean {
  if (/(storage|object|bucket|blob|s3|asset)/.test(name)) return true;
  return /_key$/.test(name) && /(file|photo|poster|logo|image|media|upload|attachment|document|scan)/.test(name);
}

export function familyById(id: string): ObjectFamily | undefined {
  return OBJECT_FAMILIES.find((family) => family.id === id);
}

/** A row of the archive's object list. */
export interface ObjectRow {
  family: ObjectFamily;
  id: string;
  key: string;
  sha256: string;
  mime: string;
  /** The object names under the key: [''] for the key itself, else the renditions. */
  parts: string[];
}

const HEX64 = /^[0-9a-f]{64}$/;

/** The stored objects of a row: `<key>` itself, or `<key>/<rendition>` for each rendition. */
export function objectKeys(row: Pick<ObjectRow, 'key' | 'parts'>): string[] {
  return row.parts.map((part) => (part === '' ? row.key : `${row.key}/${part}`));
}

/** The part whose SHA-256 the row carries ('' = the key itself). */
export function hashedPart(family: ObjectFamily): string {
  return family.hashed === '-' ? '' : family.hashed;
}

/**
 * Reads one line of the object list. Three shapes:
 *   `<family>|<id>|<key>|<sha256>|<mime>|<parts>`  what OBJECT_FAMILIES' SELECTs print
 *   `<key>`                                        one evidence key (the M12 `copy` input)
 *   `<id>|<key>|<sha256>`                          one evidence row (the M12 `verify` input)
 *   `<key>|<mime>|<sha256>`                        one evidence row (the M12 `restore` input)
 * `legacy` says which of the three short shapes the command takes. Returns null for a line that
 * is none of them (the caller counts it and fails).
 */
export function parseRow(line: string, legacy: 'copy' | 'verify' | 'restore'): ObjectRow | null {
  const fields = line.split('|');
  const evidence = OBJECT_FAMILIES[0]!;
  if (fields.length === 6) {
    const [familyId = '', id = '', key = '', sha256 = '', mime = '', parts = ''] = fields;
    const family = familyById(familyId);
    if (!family || !id || !key || !HEX64.test(sha256) || !mime) return null;
    const names = parts === '-' ? [''] : parts.split(',');
    if (names.some((name) => name !== '' && !/^(?:96|512|full)$/.test(name))) return null;
    if (parts === '-' ? family.hashed !== '-' : family.hashed === '-') return null;
    if (!names.includes(hashedPart(family))) return null;
    return { family, id, key, sha256, mime, parts: names };
  }
  if (legacy === 'copy' && fields.length === 1 && fields[0]) {
    return { family: evidence, id: '', key: fields[0], sha256: '', mime: '', parts: [''] };
  }
  if (legacy === 'verify' && fields.length === 3) {
    const [id = '', key = '', sha256 = ''] = fields;
    return id && key ? { family: evidence, id, key, sha256, mime: '', parts: [''] } : null;
  }
  if (legacy === 'restore' && fields.length === 3) {
    const [key = '', mime = '', sha256 = ''] = fields;
    return key && mime ? { family: evidence, id: '', key, sha256, mime, parts: [''] } : null;
  }
  return null;
}

/**
 * The SQL that lists the objects of the database, one `<family>|<id>|<key>|<sha256>|<mime>|<parts>`
 * line per row (psql -t -A). Without `sample` every row of every family (the archive copy and the
 * real restore); with it, that many random rows of each family (the drill). `only` limits it to one
 * family.
 */
export function listSql(options: { sample?: number; only?: string } = {}): string {
  const families = options.only ? OBJECT_FAMILIES.filter((f) => f.id === options.only) : OBJECT_FAMILIES;
  if (families.length === 0) throw new Error('unknown object family');
  const sample = options.sample;
  if (sample !== undefined && (!Number.isInteger(sample) || sample < 1)) throw new Error('the sample must be a whole number of at least 1');
  const branches = families.map((family) =>
    sample === undefined
      ? `(${family.select} ORDER BY 1)`
      : `(${family.select} ORDER BY random() LIMIT ${sample})`,
  );
  return `SELECT line FROM (${branches.join(' UNION ALL ')}) AS objects`;
}
