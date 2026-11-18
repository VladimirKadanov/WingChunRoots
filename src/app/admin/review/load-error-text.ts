// The review pages' load error in the control panel's language (REVIEW_LOAD_ERRORS.review in English,
// src/components/account/review-load-error-text.ts; docs/adr/0043-admin-bulgarian.md).

import type { AdminT } from '@/components/admin/i18n/translate';

export function reviewLoadError(t: AdminT) {
  return {
    eyebrow: t('Administration'),
    title: t('Review queue'),
    message: t("We couldn't load the review queue. Nothing was changed."),
    back: { href: '/admin', label: t('Back to administration') },
  };
}
