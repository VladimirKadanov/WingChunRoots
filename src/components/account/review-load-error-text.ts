// What the error state of the M10a pages says when their own read fails (rendered on the server,
// with a "Try again" link): the historical teacher form and the review queue. Apart from
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
} as const;
