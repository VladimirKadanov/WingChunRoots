// The shared load error's own words in the control panel's language (src/components/account/load-error.tsx,
// docs/adr/0043-admin-bulgarian.md): every /admin page passes them as `words`.

import type { AdminT } from './translate';

export function loadErrorWords(t: AdminT): { retry: string; retrying: string; brief: string } {
  return { retry: t('Try again'), retrying: t('Trying again…'), brief: t('This is usually brief: try again in a moment.') };
}
