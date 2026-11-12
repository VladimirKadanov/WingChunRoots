// The words of the error state of an organization's billing page (/dashboard/organization/<id>/billing) (M23; ../load-error.tsx).

export const ORGANIZATION_BILLING_LOAD_ERROR = {
  eyebrow: 'Your organizations',
  title: 'Organization billing',
  message: "We couldn't load the organization's billing. Nothing was changed or charged.",
  back: { href: '/dashboard/organization', label: 'Back to your organizations' },
} as const;
