// The words of the error state of /account/privacy (M07)
// (../load-error.tsx). One module per page: see ../load-error.tsx.

export const PRIVACY_LOAD_ERROR = {
  eyebrow: 'Settings',
  title: 'Privacy and consents',
  message: "We couldn't load your consents. Nothing was changed.",
  back: { href: '/account', label: 'Back to settings' },
} as const;
