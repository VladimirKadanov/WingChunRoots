'use server';

// The control panel's language switch (owner request 2026-11-18, docs/adr/0043-admin-bulgarian.md):
// keeps the browser's choice in a cookie scoped to /admin and returns to the page it came from. A
// display preference, not data: no service, no audit entry, and it works with scripts off (a plain
// form post). Full administrators only. Only an /admin address is accepted as the way back.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { mayChooseAdminLang } from '@/components/admin/i18n/server';
import { ADMIN_LANG_COOKIE, isAdminLang } from '@/components/admin/i18n/translate';
import { appUrl } from '@/server/auth/env';

const YEAR_S = 365 * 24 * 60 * 60;

/** `back` when it is an /admin address on this site, else /admin. */
async function adminBack(back: unknown): Promise<string> {
  if (typeof back !== 'string') return '/admin';
  return /^\/admin(?:[/?#]|$)/.test(back) && !back.startsWith('//') && !back.includes('\\') ? back : '/admin';
}

export async function setAdminLanguage(formData: FormData): Promise<void> {
  const lang = formData.get('lang');
  // Only a full administrator has a choice (getAdminLang ignores the cookie for every other role).
  if (isAdminLang(lang) && (await mayChooseAdminLang())) {
    (await cookies()).set(ADMIN_LANG_COOKIE, lang, { path: '/admin', maxAge: YEAR_S, sameSite: 'lax', secure: appUrl().startsWith('https:') });
  }
  redirect(await adminBack(formData.get('back')));
}
