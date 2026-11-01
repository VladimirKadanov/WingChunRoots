// The words of the error state of /dashboard/schools/[id] and its edit page (M11)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const SCHOOL_LOAD_ERROR = {
  eyebrow: 'Your schools',
  title: 'Your school',
  message: "We couldn't load this school. Nothing was changed.",
  back: { href: '/dashboard/schools', label: 'Back to your schools' },
} as const;
