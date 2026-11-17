// The dashboard home's "Next steps" (owner request 2026-11-17, docs/adr/0036-member-navigation.md).

export type InstructorState = 'not_instructor' | 'unverified' | 'verified';

export interface NextStep {
  key: 'profile' | 'teacher' | 'school' | 'instructor';
  label: string;
  hint: string;
  href: string;
  done: boolean;
}

/**
 * The "Next steps" of the dashboard home: the few things a new account still has to do before the
 * site is useful to it, in order. Empty once every step is done (the card then disappears), and
 * for a staff account without a profile. Pure: the counts come from the caller.
 */
export function nextSteps(input: {
  accountType: 'student' | 'sifu';
  instructor: InstructorState;
  hasProfile: boolean;
  staffOnly: boolean;
  teacherLinks: number;
  schools: number;
}): NextStep[] {
  if (input.staffOnly) return [];
  const steps: NextStep[] = [
    {
      key: 'profile',
      label: 'Set up your profile',
      hint: 'Your name in every script you use, and where you train.',
      href: '/onboarding?next=%2Fdashboard',
      done: input.hasProfile,
    },
  ];
  if (input.accountType === 'student') {
    steps.push({
      key: 'teacher',
      label: 'Name your teacher',
      hint: 'They confirm the link, then it shows on both profiles.',
      href: '/dashboard/teachers/new',
      done: input.teacherLinks > 0,
    });
  } else {
    steps.push(
      {
        key: 'instructor',
        label: 'Verify as an instructor',
        hint: 'Send evidence once; reviewers confirm it and your profile shows the instructor badge.',
        href: '/dashboard/instructor',
        done: input.instructor === 'verified',
      },
      {
        key: 'school',
        label: 'List your school',
        hint: 'Students find it on the map and can ask for a trial lesson.',
        href: '/dashboard/schools/new',
        done: input.schools > 0,
      },
    );
  }
  return steps.every((step) => step.done) ? [] : steps;
}
