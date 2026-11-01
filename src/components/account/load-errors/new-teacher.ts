// The words of the error state of /dashboard/teachers/new (M09)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const NEW_TEACHER_LOAD_ERROR = {
  eyebrow: 'Your teachers',
  title: 'Name a teacher',
  message: "We couldn't load the request form. Nothing was sent.",
  back: { href: '/dashboard/teachers', label: 'Back to your teachers' },
} as const;
