// The federation import file (milestone M24; specification §9.1): a CSV file of the source
// template, parsed and checked row by row without the database. Pure: no database, no I/O, so the
// unit tests run it on fictional rows (src/server/services/organization-import.test.ts).
//
// The template (specification §9.1): First_Name, Last_Name, Email, Chinese_Name, Start_Year,
// Current_Rank, Sifu_Database_ID, School_City. Header names match without regard to case, spaces
// or underscores; a column the template does not name is ignored and said so.
//
// DEFAULT M24 question 1: CSV only (UTF-8, with or without a byte-order mark; comma or semicolon
// as the separator, as spreadsheet programs save it; fields in double quotes may hold separators,
// quotes as "" and line breaks). An Excel workbook is saved as "CSV UTF-8" first.
// DEFAULT M24 question 3: the Email column is never read: its values are dropped while parsing,
// so no address reaches the database, a log or the preview. Invitations wait for the consent policy.

import { isLatinName, matchesScript, NAME_MAX_LENGTH, cleanName } from './names';
import { ORGANIZATION_IMPORT_MAX_BYTES, ORGANIZATION_IMPORT_MAX_ROWS, ORGANIZATION_MEMBER_FIELD_MAX, type ImportRowError } from '../db/schema/organization-tools';

export const TEMPLATE_COLUMNS = ['First_Name', 'Last_Name', 'Email', 'Chinese_Name', 'Start_Year', 'Current_Rank', 'Sifu_Database_ID', 'School_City'] as const;
export type TemplateColumn = (typeof TEMPLATE_COLUMNS)[number];

/** The header line of the template, as the import page offers it. */
export const TEMPLATE_HEADER = TEMPLATE_COLUMNS.join(',');

/** A row of the file as the checks see it (Email is never kept). */
export interface ParsedRow {
  rowNumber: number;
  firstName: string;
  lastName: string;
  chineseName: string;
  startYear: string;
  rank: string;
  sifuId: string;
  schoolCity: string;
}

export interface ParsedFile {
  rows: ParsedRow[];
  /** Columns of the file that the template does not name (ignored). */
  ignoredColumns: string[];
  /** Whether the file has an Email column (never read). */
  emailColumn: boolean;
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportFileError';
  }
}

const normalizeHeader = (h: string) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const HEADER_OF = new Map(TEMPLATE_COLUMNS.map((c) => [normalizeHeader(c), c]));

/** The records of a CSV text (RFC 4180, with `separator`); throws ImportFileError on a broken quote. */
export function csvRecords(text: string, separator: ',' | ';'): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field === '') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === separator) {
      record.push(field);
      field = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      record.push(field);
      records.push(record);
      record = [];
      field = '';
      i += ch === '\r' && text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) throw new ImportFileError('A quoted field is not closed. Check the file’s quotation marks.');
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  // Blank lines (a record of one empty field) are not rows.
  return records.filter((r) => !(r.length === 1 && r[0]!.trim() === ''));
}

/** Parses the file into rows of the template; throws ImportFileError for a file it cannot use. */
export function parseImportFile(bytes: Uint8Array): ParsedFile {
  if (bytes.byteLength === 0) throw new ImportFileError('The file is empty.');
  if (bytes.byteLength > ORGANIZATION_IMPORT_MAX_BYTES) throw new ImportFileError(`The file is larger than ${ORGANIZATION_IMPORT_MAX_BYTES / 1024} KB. Split it into smaller files.`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new ImportFileError('The file is not UTF-8 text. Save it as “CSV UTF-8” and upload it again.');
  }
  text = text.replace(/^﻿/, '');
  if (text.includes('\u0000')) throw new ImportFileError('The file is not a CSV text file.');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const separator: ',' | ';' = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const records = csvRecords(text, separator);
  const header = records.shift();
  if (!header) throw new ImportFileError('The file is empty.');
  const columns = header.map((h) => HEADER_OF.get(normalizeHeader(h)) ?? null);
  const seen = new Set<TemplateColumn>();
  for (const c of columns) {
    if (c && seen.has(c)) throw new ImportFileError(`The column ${c} appears twice.`);
    if (c) seen.add(c);
  }
  if (!seen.has('First_Name')) throw new ImportFileError('The first line must name the columns of the template; First_Name is missing.');
  if (records.length === 0) throw new ImportFileError('The file has a header and no rows.');
  if (records.length > ORGANIZATION_IMPORT_MAX_ROWS) throw new ImportFileError(`The file has ${records.length} rows; at most ${ORGANIZATION_IMPORT_MAX_ROWS} fit in one import.`);
  const ignoredColumns = header.filter((h, i) => columns[i] === null && h.trim() !== '').map((h) => h.trim().slice(0, 40));
  const rows = records.map((record, index): ParsedRow => {
    const value = (column: TemplateColumn) => {
      const at = columns.indexOf(column);
      return at === -1 ? '' : (record[at] ?? '').trim();
    };
    // Email is never read (DEFAULT M24 question 3).
    return {
      rowNumber: index + 2,
      firstName: value('First_Name'),
      lastName: value('Last_Name'),
      chineseName: value('Chinese_Name'),
      startYear: value('Start_Year'),
      rank: value('Current_Rank'),
      sifuId: value('Sifu_Database_ID'),
      schoolCity: value('School_City'),
    };
  });
  return { rows, ignoredColumns, emailColumn: seen.has('Email') };
}

/** The checks of one row that need no database: the fields as the commit stores them, or errors. */
export interface CheckedRow {
  rowNumber: number;
  name: string;
  chineseName: string | null;
  startYear: number | null;
  rank: string | null;
  /** The teacher's profile address (slug), from Sifu_Database_ID (a slug or a /people/<slug> address). */
  teacherSlug: string | null;
  schoolCity: string | null;
  errors: ImportRowError[];
}

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** A slug from Sifu_Database_ID: `demo-hub-a`, `/people/demo-hub-a` or a full address of a profile. */
export function teacherSlugOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const path = trimmed.replace(/^https?:\/\/[^/]+/i, '');
  const match = /^\/?(?:people\/)?([a-z0-9-]+)\/?$/.exec(path);
  return match && SLUG.test(match[1]!) ? match[1]! : '';
}

export function checkRow(row: ParsedRow, thisYear: number): CheckedRow {
  const errors: ImportRowError[] = [];
  const err = (field: TemplateColumn | 'row', message: string) => errors.push({ field, message });
  const name = cleanName(`${row.firstName} ${row.lastName}`);
  if (!row.firstName) err('First_Name', 'First_Name is empty.');
  else if (name.length > NAME_MAX_LENGTH) err('First_Name', `The name is longer than ${NAME_MAX_LENGTH} characters.`);
  else if (!isLatinName(name)) err('First_Name', 'Use Latin letters in First_Name and Last_Name; the Chinese name goes in Chinese_Name.');
  let chineseName: string | null = null;
  if (row.chineseName) {
    chineseName = cleanName(row.chineseName);
    if (chineseName.length > NAME_MAX_LENGTH) err('Chinese_Name', `The name is longer than ${NAME_MAX_LENGTH} characters.`);
    else if (!matchesScript(chineseName, 'zh-Hant')) err('Chinese_Name', 'Chinese_Name takes Chinese characters only.');
  }
  let startYear: number | null = null;
  if (row.startYear) {
    if (!/^\d{4}$/.test(row.startYear)) err('Start_Year', 'Start_Year is a year of four digits, such as 2015.');
    else {
      startYear = Number(row.startYear);
      if (startYear < 1900 || startYear > thisYear) err('Start_Year', `Start_Year is between 1900 and ${thisYear}.`);
    }
  }
  const text = (column: TemplateColumn, value: string): string | null => {
    if (!value) return null;
    const cleaned = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (CONTROL.test(cleaned)) err(column, `${column} has characters that are not text.`);
    else if (cleaned.length > ORGANIZATION_MEMBER_FIELD_MAX) err(column, `${column} is longer than ${ORGANIZATION_MEMBER_FIELD_MAX} characters.`);
    return cleaned || null;
  };
  const rank = text('Current_Rank', row.rank);
  const schoolCity = text('School_City', row.schoolCity);
  const teacherSlug = teacherSlugOf(row.sifuId);
  if (teacherSlug === '') err('Sifu_Database_ID', 'Sifu_Database_ID is the address of the teacher’s profile, such as /people/demo-hub-a.');
  return { rowNumber: row.rowNumber, name, chineseName, startYear, rank, teacherSlug: teacherSlug || null, schoolCity, errors };
}

/** The key two rows of one file share when they name the same person (the duplicate check). */
export function nameKey(name: string): string {
  return cleanName(name).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
}
