// The words of the error state of the test checkout page (/billing/test-checkout/[id]) (M22; ../load-error.tsx).

export const TEST_CHECKOUT_LOAD_ERROR = {
  eyebrow: 'Billing',
  title: 'Test checkout',
  message: "We couldn't load this checkout. Nothing was charged.",
  back: { href: '/dashboard/billing', label: 'Back to billing' },
} as const;
