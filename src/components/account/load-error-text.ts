// What the error state of each M08 page says (M08 final check, requirements-2): the same words
// whether the page caught the failure of its own read (rendered on the server, with a "Try again"
// link) or an error.tsx boundary caught something else (with the boundary's retry). A plain module,
// so server pages and the client boundaries both read the values (src/components/account/load-error.tsx).

export const LOAD_ERRORS = {
  dashboard: {
    eyebrow: 'Dashboard',
    title: 'Your dashboard',
    message: "We couldn't load your dashboard. Nothing was changed.",
    back: { href: '/', label: 'Back to Explore' },
  },
  settings: {
    eyebrow: 'Dashboard',
    title: 'Account type and plan',
    message: "We couldn't load your account type and plan. Nothing was changed.",
    back: { href: '/dashboard', label: 'Back to the dashboard' },
  },
  grants: {
    eyebrow: 'Administration',
    title: 'Plan grants',
    message: "We couldn't load the plan grants. Nothing was changed.",
    back: { href: '/admin', label: 'Back to administration' },
  },
} as const;
