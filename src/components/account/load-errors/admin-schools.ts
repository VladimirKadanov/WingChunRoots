// The words of the error state of /admin/schools (M20) (../load-error.tsx). One module per page:
// see ../load-error.tsx.

export const ADMIN_SCHOOLS_LOAD_ERROR = {
  eyebrow: 'Administration',
  title: 'School activity',
  message: "We couldn't load the schools. Nothing was changed.",
  back: { href: '/admin', label: 'Back to administration' },
} as const;
