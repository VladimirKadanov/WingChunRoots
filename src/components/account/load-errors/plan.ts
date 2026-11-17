// The words of the error state of /dashboard/settings (M08)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const SETTINGS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Account type and plan',
  message: "We couldn't load your account type and plan. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
