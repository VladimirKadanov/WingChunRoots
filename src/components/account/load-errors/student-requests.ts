// The words of the error state of /dashboard/students/requests (M09)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const STUDENT_REQUESTS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Student requests',
  message: "We couldn't load your student requests. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
