// A person node's relationships in words (relations.ts; milestone M06, package F): its
// aria-describedby text, in plural and singular, with the teachers and students not drawn.

import { describe, expect, it } from 'vitest';

import { relationsText, summaryText } from './relations';
import { STUDENTS_PER_PAGE } from './students-list';

describe('relationsText', () => {
  it('names the teachers drawn and counts those not drawn', () => {
    expect(relationsText(['A', 'B'], { teachers: 4, students: 14 }, { teachers: 2, students: 12 })).toBe('Student of A, B, and 2 teachers not drawn. 14 students, 12 drawn.');
    expect(relationsText(['A'], { teachers: 2, students: 0 }, { teachers: 1, students: 0 })).toBe('Student of A and 1 teacher not drawn. No students in the record.');
  });

  it('words one teacher and one student in the singular, and says when all are drawn', () => {
    expect(relationsText(['A'], { teachers: 1, students: 1 }, { teachers: 1, students: 1 })).toBe('Student of A. 1 student, all drawn.');
  });

  it('says when no teacher is drawn, or none is in the record', () => {
    expect(relationsText([], { teachers: 1, students: 1 }, { teachers: 0, students: 1 })).toBe('1 teacher, not drawn. 1 student, all drawn.');
    expect(relationsText([], { teachers: 0, students: 3 }, { teachers: 0, students: 0 })).toBe('No teachers in the record. 3 students, 0 drawn.');
  });
});

describe('summaryText', () => {
  it('says what the summary node opens, with the students list\'s page size', () => {
    expect(summaryText('Demo Teacher')).toBe(`Opens the list of all students of Demo Teacher, ${STUDENTS_PER_PAGE} to a page.`);
  });
});
