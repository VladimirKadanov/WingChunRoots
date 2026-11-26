// The dashboard home's "Next steps" (owner request 2026-11-17, docs/adr/0039-member-navigation.md).

export type InstructorState = 'not_instructor' | 'unverified' | 'verified';

export interface NextStep {
  key: 'profile' | 'teacher' | 'school' | 'instructor' | 'public' | 'photo';
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
  /** A claim of a profile waits for the reviewers: the profile comes with it, so no steps yet. */
  pendingClaim?: boolean;
  teacherLinks: number;
  schools: number;
  /** Role replay 2026-11-25 (P2-2): the own profile is public, and it has a profile photo. */
  profilePublic?: boolean;
  hasPhoto?: boolean;
}): NextStep[] {
  if (input.staffOnly || input.pendingClaim) return [];
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
  // P2-2: what lets the lineage show the person, and lets people recognise them.
  steps.push(
    {
      key: 'public',
      label: 'Make your profile public',
      hint: 'Your confirmed links appear in the public lineage once both people are public.',
      href: '/dashboard/profile',
      done: input.profilePublic === true,
    },
    {
      key: 'photo',
      label: 'Add a photo',
      hint: 'The cards in the lineage show it, so people recognise you.',
      href: '/dashboard/photos',
      done: input.hasPhoto === true,
    },
  );
  return steps.every((step) => step.done) ? [] : steps;
}
