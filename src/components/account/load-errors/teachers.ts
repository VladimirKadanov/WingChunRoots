// The words of the error state of /dashboard/teachers (M09)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const TEACHERS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your teachers',
  message: "We couldn't load your teachers and requests. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
