// The words of the error state of /dashboard/notifications (M18)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const NOTIFICATIONS_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Notifications',
  message: "We couldn't load your notifications. Nothing was changed.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
