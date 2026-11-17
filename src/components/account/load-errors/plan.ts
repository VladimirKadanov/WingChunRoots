// The words of the error state of /account/plan (M08; /dashboard/settings until the usability
// review of 2026-11) (../load-error.tsx). One module per page: see ../load-error.tsx.

export const PLAN_LOAD_ERROR = {
  eyebrow: 'Settings',
  title: 'Plan and billing',
  message: "We couldn't load your account type and plan. Nothing was changed.",
  back: { href: '/account', label: 'Back to settings' },
} as const;
