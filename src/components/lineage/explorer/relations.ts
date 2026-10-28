// A person's relationships in words (plan §4.9; milestone M06, package F): the description of a
// person node (aria-describedby), read after its name: the teachers drawn by name, then how many
// students the person has in the record and how many of them are drawn. In the canvas's chunk:
// the explorer's first JavaScript carries only the names and the counts (explorer.tsx flowBase).

const listFormat = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });
const counted = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Teachers and students: in the record (public), and drawn in the view. */
export interface RelationCounts {
  teachers: number;
  students: number;
}

/** "Student of A and B. 14 students, 12 drawn." (`teachers`: the names of the teachers drawn). */
export function relationsText(teachers: readonly string[], totals: RelationCounts, drawn: RelationCounts): string {
  const notDrawn = Math.max(0, totals.teachers - drawn.teachers);
  const others = notDrawn > 0 ? [`${counted(notDrawn, 'teacher', 'teachers')} not drawn`] : [];
  const first =
    teachers.length > 0
      ? `Student of ${listFormat.format([...teachers, ...others])}.`
      : notDrawn > 0
        ? `${counted(notDrawn, 'teacher', 'teachers')}, not drawn.`
        : 'No teachers in the record.';
  const second =
    totals.students === 0
      ? 'No students in the record.'
      : drawn.students >= totals.students
        ? `${counted(totals.students, 'student', 'students')}, all drawn.`
        : `${counted(totals.students, 'student', 'students')}, ${drawn.students} drawn.`;
  return `${first} ${second}`;
}

/**
 * The description of a summary node "and N more" (its aria-describedby): what it opens. The page's
 * size is the students list's (students-list.tsx STUDENTS_PER_PAGE; relations.test.ts keeps them one).
 */
export function summaryText(teacher: string): string {
  return `Opens the list of all students of ${teacher}, 20 to a page.`;
}
