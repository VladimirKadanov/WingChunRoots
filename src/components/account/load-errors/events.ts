// The words of the error state of /dashboard/events and its forms (M17) (../load-error.tsx). One
// module per page: see ../load-error.tsx.

export const EVENTS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your events',
  message: "We couldn't load your events. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
