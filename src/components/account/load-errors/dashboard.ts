// The words of the error state of /dashboard (M08)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const DASHBOARD_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your dashboard',
  message: "We couldn't load your dashboard. Nothing was changed.",
  back: { href: '/', label: 'Back to Explore' },
} as const;
