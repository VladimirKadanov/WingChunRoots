import { describe, expect, it } from 'vitest';

import type { PeriodDto } from '@/server/dto/public';
import { placeText } from './person-header';
import { asStudentEdges, isHistoricalRelation, kindsOf, periodText, relationStatus, sameNameNotes, startYear, strokeOf } from './status';

const period = (from: string | null, to: string | null, ongoing = false): PeriodDto => ({
  from,
  to,
  ongoing,
  precision: from === null ? 'unknown' : from.length === 4 ? 'year' : from.length === 7 ? 'month' : 'day',
});

describe('periodText', () => {
  it('closes up an en dash between years and spaces it when an end has a space', () => {
    expect(periodText([period('1992', '1994'), period('1996', null, true)])).toBe('1992–1994, 1996–present');
    expect(periodText([period('1992-02', null, true)])).toBe('Feb 1992 – present');
    expect(periodText([period('1992-02-03', '1994')])).toBe('3 Feb 1992 – 1994');
  });

  it('says what it knows when an end is missing, and when nothing is', () => {
    expect(periodText([period('1990', null)])).toBe('from 1990');
    expect(periodText([period(null, '1990')])).toBe('until 1990');
    expect(periodText([period(null, null, true)])).toBe('Ongoing');
    expect(periodText([period('1990', '1990')])).toBe('1990');
    expect(periodText([])).toBe('Dates not recorded');
  });
});

describe('startYear and isHistoricalRelation', () => {
  it('takes the earliest dated start, whatever the precision', () => {
    expect(startYear([period('1996', null, true), period('1992-02', '1994')])).toBe('1992');
    expect(startYear([period(null, '1990')])).toBeNull();
  });

  it('is historical only when every period ended', () => {
    expect(isHistoricalRelation([period('1981', '1983')])).toBe(true);
    expect(isHistoricalRelation([period('1981', '1983'), period('1990', null, true)])).toBe(false);
    expect(isHistoricalRelation([period(null, null)])).toBe(false);
    expect(isHistoricalRelation([])).toBe(false);
  });
});

describe('the state of a relationship, as a word and a stroke', () => {
  it('names a request "Pending" and draws the unconfirmed seal (DEFAULT D03)', () => {
    expect(relationStatus('pending_teacher')).toEqual({ kind: 'unconfirmed', label: 'Pending' });
    expect(relationStatus('awaiting_claim')).toEqual({ kind: 'unconfirmed', label: 'Pending' });
    expect(relationStatus('under_review')).toEqual({ kind: 'under_review', label: 'Under review' });
  });

  it('draws a state that is not verified before the cross-lineage curve and the historical line', () => {
    const ended = [period('1981', '1983')];
    expect(strokeOf({ status: 'under_review', periods: ended, kind: 'crossLineage' })).toBe('under_review');
    expect(strokeOf({ status: 'verified', periods: ended, kind: 'crossLineage' })).toBe('cross_lineage');
    expect(strokeOf({ status: 'verified', periods: ended, kind: 'primary' })).toBe('historical');
    expect(strokeOf({ status: 'verified', periods: [period('1990', null, true)], kind: 'primary' })).toBe('verified');
  });

  it('keys a student row without the cross-lineage mark, which belongs to the teachers', () => {
    const edges = [{ status: 'verified' as const, periods: [period('1990', null, true)], kind: 'crossLineage' as const }];
    expect(kindsOf(edges)).toEqual(['verified', 'cross_lineage']);
    expect(kindsOf(asStudentEdges(edges))).toEqual(['verified']);
    expect(strokeOf(asStudentEdges(edges)[0]!)).toBe('verified');
  });
});

describe('sameNameNotes', () => {
  it('notes only names that occur twice, by year, else lineage, else what the caller gives', () => {
    const byYear = sameNameNotes([
      { id: 'a', displayName: 'Anna Notreal', year: '1990', lineage: 'Demo Lineage A' },
      { id: 'b', displayName: 'Anna Notreal', year: '1996', lineage: 'Demo Lineage A' },
      { id: 'c', displayName: 'Theo Stubbard', year: '1990' },
    ]);
    expect(Object.fromEntries(byYear)).toEqual({ a: 'since 1990', b: 'since 1996' });

    const byLineage = sameNameNotes([
      { id: 'a', displayName: 'Anna Notreal', year: '1990', lineage: 'Demo Lineage A' },
      { id: 'b', displayName: 'Anna Notreal', year: '1990', lineage: 'Demo Lineage B' },
    ]);
    expect(Object.fromEntries(byLineage)).toEqual({ a: 'Demo Lineage A', b: 'Demo Lineage B' });

    const byOther = sameNameNotes([
      { id: 'a', displayName: 'Anna Notreal', year: null, other: 'student of Theo Stubbard' },
      { id: 'b', displayName: 'Anna Notreal', year: null, other: 'student of Lau Ka Sam' },
    ]);
    expect(Object.fromEntries(byOther)).toEqual({ a: 'student of Theo Stubbard', b: 'student of Lau Ka Sam' });
  });

  it('falls back to numbering the records when nothing tells them apart', () => {
    const notes = sameNameNotes([
      { id: 'a', displayName: 'Anna Notreal' },
      { id: 'b', displayName: 'Anna Notreal' },
    ]);
    expect(Object.fromEntries(notes)).toEqual({ a: 'record 1 of 2', b: 'record 2 of 2' });
  });
});

describe('placeText', () => {
  it('shows the city by name with the country, never a point', () => {
    expect(placeText({ cityName: 'Demo City', countryCode: 'GB' })).toBe('Demo City, United Kingdom');
    expect(placeText({ cityName: null, countryCode: 'DE' })).toBe('Germany');
    expect(placeText({ cityName: null, countryCode: null })).toBeNull();
  });
});
