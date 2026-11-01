// The words of the error state of /dashboard/profile, the profile editor (M07)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const PROFILE_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Your profile',
  message: "We couldn't load your profile. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
