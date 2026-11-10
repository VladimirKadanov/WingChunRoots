// The words of the error states of the M21 trial lesson pages (../load-error.tsx): the request form
// of a school, the sender's requests, and a school's inbox. One module per page: see ../load-error.tsx.

export const TRIAL_REQUEST_LOAD_ERROR = {
  eyebrow: 'Schools',
  title: 'Request a trial lesson',
  message: "We couldn't load this school's trial lesson form. Nothing was sent.",
  back: { href: '/schools', label: 'Back to the schools' },
} as const;

export const OWN_TRIAL_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your trial lesson requests',
  message: "We couldn't load your trial lesson requests. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;

export const TRIAL_INBOX_LOAD_ERROR = {
  eyebrow: 'Your schools',
  title: 'Trial lesson requests',
  message: "We couldn't load the trial lesson requests. Nothing was changed.",
  back: { href: '/dashboard/schools', label: 'Back to your schools' },
} as const;

export const SCHOOL_STATS_LOAD_ERROR = {
  eyebrow: 'Your schools',
  title: 'School statistics',
  message: "We couldn't load the statistics. Nothing was changed.",
  back: { href: '/dashboard/schools', label: 'Back to your schools' },
} as const;

export const SCHEDULE_LOAD_ERROR = {
  eyebrow: 'Your schools',
  title: 'Schedule and fees',
  message: "We couldn't load the schedule. Nothing was changed.",
  back: { href: '/dashboard/schools', label: 'Back to your schools' },
} as const;
