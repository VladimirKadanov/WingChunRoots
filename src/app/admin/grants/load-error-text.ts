// The words of the error state of /admin/grants in the control panel's language
// (docs/adr/0043-admin-bulgarian.md), for the page and its error boundary alike (a client file, so
// the entries are in BG_GRANTS_CLIENT). The address of the way back stays as it is.

import { GRANTS_LOAD_ERROR } from '@/components/account/load-errors/grants';
import type { AdminT } from '@/components/admin/i18n/translate';

export function grantsLoadError(t: AdminT) {
  return {
    eyebrow: t('Administration'),
    title: t('Plan grants'),
    message: t("We couldn't load the plan grants. Nothing was changed."),
    back: { href: GRANTS_LOAD_ERROR.back.href, label: t('Back to administration') },
  };
}
