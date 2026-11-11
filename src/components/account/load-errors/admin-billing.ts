// The words of the error state of the staff's subscriptions (/admin/billing) (M22; ../load-error.tsx).

export const ADMIN_BILLING_LOAD_ERROR = {
  eyebrow: 'Admin',
  title: 'Subscriptions',
  message: "We couldn't load the subscriptions. Nothing was changed.",
  back: { href: '/admin', label: 'Back to the admin overview' },
} as const;
