// The federation import file (milestone M24): parsing and the checks that need no database, on
// clearly fictional rows (D20: `Demo …` names, demo- slugs).

import { describe, expect, it } from 'vitest';

import { ORGANIZATION_IMPORT_MAX_BYTES, ORGANIZATION_IMPORT_MAX_ROWS } from '../db/schema/organization-tools';
import { checkRow, csvRecords, ImportFileError, nameKey, parseImportFile, TEMPLATE_HEADER, teacherSlugOf } from './organization-import-csv';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('csvRecords', () => {
  it('reads quoted fields with separators, doubled quotes and line breaks, CRLF and LF', () => {
    expect(csvRecords('a,"b, c","d ""e""",\r\n"f\ng",h\n\n', ',')).toEqual([
      ['a', 'b, c', 'd "e"', ''],
      ['f\ng', 'h'],
    ]);
  });

  it('refuses a quoted field that is never closed', () => {
    expect(() => csvRecords('a,"b\n', ',')).toThrow(ImportFileError);
  });
});

describe('parseImportFile', () => {
  it('reads the template with a byte-order mark, in any case of the header, and never keeps the Email column', () => {
    const file = parseImportFile(bytes(`﻿${TEMPLATE_HEADER.toLowerCase()},Notes\nDemo,Student One,demo-one@example.test,陳大文,2015,Second level,demo-hub-a,Demo City,ignored\n`));
    expect(file.emailColumn).toBe(true);
    expect(file.ignoredColumns).toEqual(['Notes']);
    expect(file.rows).toEqual([
      { rowNumber: 2, firstName: 'Demo', lastName: 'Student One', chineseName: '陳大文', startYear: '2015', rank: 'Second level', sifuId: 'demo-hub-a', schoolCity: 'Demo City' },
    ]);
    expect(JSON.stringify(file)).not.toContain('example.test');
  });

  it('takes semicolons as the separator when the header has no comma', () => {
    const file = parseImportFile(bytes('First_Name;Last_Name\nDemo;Student Two\n'));
    expect(file.rows[0]).toMatchObject({ firstName: 'Demo', lastName: 'Student Two' });
  });

  it('refuses an empty file, a file without First_Name, a repeated column, no rows, too many rows, too many bytes and text that is not UTF-8', () => {
    expect(() => parseImportFile(bytes(''))).toThrow('The file is empty.');
    expect(() => parseImportFile(bytes('Name,City\nDemo,X\n'))).toThrow(/First_Name is missing/);
    expect(() => parseImportFile(bytes('First_Name,first name\nDemo,Demo\n'))).toThrow(/appears twice/);
    expect(() => parseImportFile(bytes('First_Name\n'))).toThrow(/no rows/);
    expect(() => parseImportFile(bytes(`First_Name\n${'Demo\n'.repeat(ORGANIZATION_IMPORT_MAX_ROWS + 1)}`))).toThrow(/at most 500/);
    expect(() => parseImportFile(new Uint8Array(ORGANIZATION_IMPORT_MAX_BYTES + 1).fill(65))).toThrow(/larger than/);
    expect(() => parseImportFile(new Uint8Array([0x46, 0xff, 0xfe, 0x0a]))).toThrow(/not UTF-8/);
  });
});

describe('checkRow', () => {
  const row = (fields: Partial<Parameters<typeof checkRow>[0]>) => ({ rowNumber: 2, firstName: 'Demo', lastName: 'Student', chineseName: '', startYear: '', rank: '', sifuId: '', schoolCity: '', ...fields });

  it('keeps a valid row as the commit stores it', () => {
    expect(checkRow(row({ chineseName: '陳 大文', startYear: '2015', rank: '  Second   level ', sifuId: '/people/demo-hub-a', schoolCity: 'Demo City' }), 2026)).toEqual({
      rowNumber: 2,
      name: 'Demo Student',
      chineseName: '陳 大文',
      startYear: 2015,
      rank: 'Second level',
      teacherSlug: 'demo-hub-a',
      schoolCity: 'Demo City',
      errors: [],
    });
  });

  it('names the column of every problem', () => {
    const checked = checkRow(row({ firstName: '', chineseName: 'Demo', startYear: '15', rank: 'x'.repeat(81), sifuId: 'Not an address!' }), 2026);
    expect(checked.errors.map((e) => e.field)).toEqual(['First_Name', 'Chinese_Name', 'Start_Year', 'Current_Rank', 'Sifu_Database_ID']);
    expect(checkRow(row({ firstName: 'Демо' }), 2026).errors[0]!.field).toBe('First_Name');
    expect(checkRow(row({ startYear: '2031' }), 2026).errors[0]!.message).toMatch(/between 1900 and 2026/);
  });

  it('reads Sifu_Database_ID as a slug, a /people/ path or a profile address', () => {
    expect(teacherSlugOf('demo-hub-a')).toBe('demo-hub-a');
    expect(teacherSlugOf('/people/demo-hub-a/')).toBe('demo-hub-a');
    expect(teacherSlugOf('https://example.test/people/demo-hub-a')).toBe('demo-hub-a');
    expect(teacherSlugOf('')).toBeNull();
    expect(teacherSlugOf('/schools/demo-school-sofia')).toBe('');
  });

  it('compares names without case and accents (the duplicate check)', () => {
    expect(nameKey('Démo  Student')).toBe(nameKey('demo student'));
  });
});
