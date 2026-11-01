// The words of the error state of /admin/grants (M08)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const GRANTS_LOAD_ERROR = {
  eyebrow: 'Administration',
  title: 'Plan grants',
  message: "We couldn't load the plan grants. Nothing was changed.",
  back: { href: '/admin', label: 'Back to administration' },
} as const;
