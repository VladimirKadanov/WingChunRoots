// The words of the error state of /account/notifications (M18; a section of /dashboard/settings
// until the usability review of 2026-11) (../load-error.tsx). One module per page: see
// ../load-error.tsx.

export const NOTIFICATION_SETTINGS_LOAD_ERROR = {
  eyebrow: 'Settings',
  title: 'Notification settings',
  message: "We couldn't load your e-mail settings. Nothing was changed.",
  back: { href: '/account', label: 'Back to settings' },
} as const;
