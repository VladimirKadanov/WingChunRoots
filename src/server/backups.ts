// The local archives that scripts/backup-local.sh writes (milestone M12; plan §3.1 "Архиви"):
// `<database>-<YYYYMMDDTHHMMSSZ>.dump` (pg_dump -Fc) beside `<same name>.sha256`, in BACKUP_DIR
// (default `backups/` in the working directory; the Compose `web` service mounts the host's
// backups/ read-only). /admin/system shows when the newest one of the app's database was made.
//
// Only file names and sizes are read here, never a dump's content.

import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

type Env = Record<string, string | undefined>;

export const DEFAULT_BACKUP_DIR = 'backups';

/** A database name as backup-local.sh puts it in a file name. */
const DATABASE = /^[A-Za-z0-9_-]{1,63}$/;
const STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/;

export interface BackupFile {
  file: string;
  /** When the dump was made (from its name, UTC, ISO 8601). */
  createdAt: string;
  sizeBytes: number;
  /** Whether its `.sha256` file is there. */
  hasChecksum: boolean;
}

export interface BackupSummary {
  latest: BackupFile | null;
  /** Dumps of this database in the folder (backup-local.sh keeps the newest 14). */
  count: number;
}

/** The folder of the archives: BACKUP_DIR, else backups/ in the working directory. */
export function backupDir(env: Env = process.env, cwd: string = process.cwd()): string {
  return path.resolve(cwd, env.BACKUP_DIR || DEFAULT_BACKUP_DIR);
}

/** The time in a dump's name `<database>-<stamp>.dump`, or null when the name is not one. */
export function backupTime(file: string, database: string): string | null {
  if (!DATABASE.test(database)) return null;
  const prefix = `${database}-`;
  if (!file.startsWith(prefix) || !file.endsWith('.dump')) return null;
  const match = STAMP.exec(file.slice(prefix.length, -'.dump'.length));
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number];
  const time = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  // Date.UTC rolls over (month 13, second 61): only a real time counts.
  return time.getUTCFullYear() === y && time.getUTCMonth() === mo - 1 && time.getUTCDate() === d && time.getUTCHours() === h && time.getUTCMinutes() === mi && time.getUTCSeconds() === s
    ? time.toISOString()
    : null;
}

/** The newest dump of `database` in `dir`, and how many there are; an absent folder has none. */
export async function backupSummary(dir: string, database: string): Promise<BackupSummary> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return { latest: null, count: 0 };
  }
  const dumps = names
    .map((file) => ({ file, createdAt: backupTime(file, database) }))
    .filter((entry): entry is { file: string; createdAt: string } => entry.createdAt !== null)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const newest = dumps[0];
  if (!newest) return { latest: null, count: 0 };
  const present = new Set(names);
  let sizeBytes = 0;
  try {
    sizeBytes = (await stat(path.join(dir, newest.file))).size;
  } catch {
    // Removed in between: still the newest name seen.
  }
  return { latest: { ...newest, sizeBytes, hasChecksum: present.has(`${newest.file}.sha256`) }, count: dumps.length };
}
