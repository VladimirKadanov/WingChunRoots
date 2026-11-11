// The words of the error state of the account's billing page (/dashboard/billing) (M22; ../load-error.tsx).

export const BILLING_LOAD_ERROR = {
  eyebrow: 'Dashboard',
  title: 'Billing',
  message: "We couldn't load your billing. Nothing was changed or charged.",
  back: { href: '/dashboard', label: 'Back to the dashboard' },
} as const;
