// The words of the error state of /dashboard/schools and /dashboard/schools/new (M11)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const SCHOOLS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your schools',
  message: "We couldn't load your schools. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
