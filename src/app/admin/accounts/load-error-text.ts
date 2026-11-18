// The words of the error state of /admin/accounts in the control panel's language
// (docs/adr/0043-admin-bulgarian.md), for the page and its error boundary alike (a client file, so
// the entries are in BG_ACCOUNTS_CLIENT). The address of the way back stays as it is.

import { ACCOUNTS_LOAD_ERROR } from '@/components/account/load-errors/accounts';
import type { AdminT } from '@/components/admin/i18n/translate';

export function accountsLoadError(t: AdminT) {
  return {
    eyebrow: t('Administration'),
    title: t('Accounts'),
    message: t("We couldn't load the suspended accounts. Nothing was changed."),
    back: { href: ACCOUNTS_LOAD_ERROR.back.href, label: t('Back to administration') },
  };
}
