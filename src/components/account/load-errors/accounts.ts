// The words of the error state of /admin/accounts (review 2026-11)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const ACCOUNTS_LOAD_ERROR = {
  eyebrow: 'Administration',
  title: 'Accounts',
  message: "We couldn't load the suspended accounts. Nothing was changed.",
  back: { href: '/admin', label: 'Back to administration' },
} as const;
