// What the error state of the M15 organization pages says when their own read fails (rendered on
// the server, with a "Try again" link). Apart from ./load-errors/ for the reason in
// ./review-load-error-text.ts: these pages have no boundary of their own.

export const ORGANIZATION_LOAD_ERRORS = {
  mine: {
    eyebrow: 'Dashboard',
    title: 'Your organizations',
    message: "We couldn't load your organizations. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  apply: {
    eyebrow: 'Your organizations',
    title: 'Apply for an organization',
    message: "We couldn't load the application form. Nothing was sent.",
    back: { href: '/dashboard/organization', label: 'Back to your organizations' },
  },
  manage: {
    eyebrow: 'Your organizations',
    title: 'Organization',
    message: "We couldn't load this organization. Nothing was changed.",
    back: { href: '/dashboard/organization', label: 'Back to your organizations' },
  },
  admin: {
    eyebrow: 'Administration',
    title: 'Organizations',
    message: "We couldn't load the organizations. Nothing was changed.",
    back: { href: '/admin', label: 'Back to administration' },
  },
} as const;
