// What the error state of the M10a and M10b pages says when their own read fails (rendered on the
// server, with a "Try again" link): the historical teacher form, the review queue, the invitation
// form and link, instructor verification, a party's case and "Report profile". Apart from
// load-error-text.ts because the error.tsx boundaries of the dashboard import that module into the
// browser, and these pages have no boundary of their own (M10a: the shared module stays as small
// as the route budget needs).

export const REVIEW_LOAD_ERRORS = {
  historicalTeacher: {
    eyebrow: 'Your teachers',
    title: 'Name a historical teacher',
    message: "We couldn't load the claim form. Nothing was sent.",
    back: { href: '/dashboard/teachers', label: 'Back to your teachers' },
  },
  review: {
    eyebrow: 'Administration',
    title: 'Review queue',
    message: "We couldn't load the review queue. Nothing was changed.",
    back: { href: '/admin', label: 'Back to administration' },
  },
  invite: {
    eyebrow: 'Your teachers',
    title: 'Invite your teacher to claim this profile',
    message: "We couldn't load the invitation form. Nothing was sent.",
    back: { href: '/dashboard/teachers', label: 'Back to your teachers' },
  },
  invitation: {
    eyebrow: 'Invitation',
    title: 'Claim your profile',
    message: "We couldn't load this invitation. Nothing was changed.",
    back: { href: '/', label: 'Back to the home page' },
  },
  instructor: {
    eyebrow: 'Dashboard',
    title: 'Instructor verification',
    message: "We couldn't load your instructor status. Nothing was sent.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  cases: {
    eyebrow: 'Dashboard',
    title: 'Your cases',
    message: "We couldn't load this case. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  report: {
    eyebrow: 'Profile',
    title: 'Report profile',
    message: "We couldn't load the report form. Nothing was sent.",
    back: { href: '/', label: 'Back to the home page' },
  },
} as const;
