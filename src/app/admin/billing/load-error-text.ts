// The words of the error state of /admin/billing and /admin/billing/[id] in the control panel's
// language (docs/adr/0043-admin-bulgarian.md). The address of the way back stays as it is.

import { ADMIN_BILLING_LOAD_ERROR } from '@/components/account/load-errors/admin-billing';
import type { AdminT } from '@/components/admin/i18n/translate';

export function billingLoadError(t: AdminT) {
  return {
    eyebrow: t('Admin'),
    title: t('Subscriptions'),
    message: t("We couldn't load the subscriptions. Nothing was changed."),
    back: { href: ADMIN_BILLING_LOAD_ERROR.back.href, label: t('Back to the admin overview') },
  };
}
