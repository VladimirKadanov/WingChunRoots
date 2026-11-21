// The words of the error state of an organization's logo and banner page (/dashboard/organization/<id>/photos) (ADR 0052; ../load-error.tsx).

export const ORGANIZATION_PHOTOS_LOAD_ERROR = {
  eyebrow: 'Your organizations',
  title: 'Logo and banner',
  message: "We couldn't load the organization's logo and banner. Nothing was changed.",
  back: { href: '/dashboard/organization', label: 'Back to your organizations' },
} as const;
