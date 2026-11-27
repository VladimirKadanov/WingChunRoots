// The dashboard home's "Next steps" (owner request 2026-11-17, docs/adr/0039-member-navigation.md).

export type InstructorState = 'not_instructor' | 'unverified' | 'verified';

export interface NextStep {
  key: 'profile' | 'teacher' | 'school' | 'instructor' | 'public' | 'photo' | 'find-school' | 'events' | 'invite';
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
  /** Journey review 2026-11-26 (P2-1): the member said "I'm new to Wing Chun" at onboarding. */
  beginner?: boolean;
  /** P2-1: trial lesson requests the account sent. */
  trials?: number;
  /** P2-3: confirmed or waiting students of a Sifu account. */
  students?: number;
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
  if (input.accountType === 'student' && input.beginner && input.teacherLinks === 0) {
    // Journey review 2026-11-26 (P2-1, ADR 0079): a member new to Wing Chun keeps a beginner's
    // steps (a school, events, then the teacher) until a teacher is named.
    steps.push(
      {
        key: 'find-school',
        label: 'Find a school',
        hint: 'Schools near you, with their times; ask one for a trial lesson.',
        href: '/schools',
        done: (input.trials ?? 0) > 0,
      },
      {
        key: 'events',
        label: 'Events near you',
        hint: 'Seminars and open classes, also for beginners.',
        href: '/events',
        done: false,
      },
      {
        key: 'teacher',
        label: 'Started training? Name your teacher',
        hint: 'They confirm the link, then it shows on both profiles.',
        href: '/dashboard/teachers/new',
        done: false,
      },
    );
    return steps;
  } else if (input.accountType === 'student') {
    steps.push({
      key: 'teacher',
      label: 'Name your teacher',
      hint: 'They confirm the link, then it shows on both profiles.',
      href: '/dashboard/teachers/new',
      done: input.teacherLinks > 0,
    });
  } else {
    // Journey review 2026-11-26 (P2-3, ADR 0079): a new Sifu account in the order the record
    // grows: their own teacher, a public profile, their students, a school, then verification.
    steps.push(
      {
        key: 'teacher',
        label: 'Name your teacher',
        hint: 'Your own line: they confirm the link, then your students’ lines reach back through you.',
        href: '/dashboard/teachers/new',
        done: input.teacherLinks > 0,
      },
      {
        key: 'public',
        label: 'Make your profile public',
        hint: 'Your confirmed links appear in the public lineage once both people are public.',
        href: '/dashboard/profile',
        done: input.profilePublic === true,
      },
      {
        key: 'invite',
        label: 'Invite your students',
        hint: 'Share your invite link or QR code; your students sign up and name you in one step.',
        href: '/dashboard/students/invite',
        done: (input.students ?? 0) > 0,
      },
      {
        key: 'school',
        label: 'List your school',
        hint: 'Students find it on the map and can ask for a trial lesson.',
        href: '/dashboard/schools/new',
        done: input.schools > 0,
      },
      {
        key: 'instructor',
        label: 'Verify as an instructor',
        hint: 'Send evidence once; reviewers confirm it and your profile shows the instructor badge.',
        href: '/dashboard/instructor',
        done: input.instructor === 'verified',
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
