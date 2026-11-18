// The control panel's language on the server (docs/adr/0043-admin-bulgarian.md). Only a full
// administrator (role admin) reads the control panel in Bulgarian and gets the switch; moderators,
// archivists and every other role always get English (owner decision 2026-11-18). For an
// administrator: the browser's choice from its cookie, else ADMIN_DEFAULT_LANGUAGE, else Bulgarian.
// Pages, layouts, metadata and Server Actions under /admin call getAdminT(); nothing is cached
// across requests.

import { cookies } from 'next/headers';

import { getRequestPrincipal } from '@/server/auth/web';

import { BG_ADMIN } from './bg';
import { ADMIN_LANG_COOKIE, type AdminLang, type AdminT, isAdminLang, makeAdminT } from './translate';

/** The language a browser without a choice gets: ADMIN_DEFAULT_LANGUAGE ('bg' or 'en'), else 'bg'. */
export function defaultAdminLang(): AdminLang {
  const configured = process.env.ADMIN_DEFAULT_LANGUAGE;
  return isAdminLang(configured) ? configured : 'bg';
}

/** Whether this session may read the control panel in Bulgarian and switch its language: full administrators only. */
export async function mayChooseAdminLang(): Promise<boolean> {
  return (await getRequestPrincipal())?.user.role === 'admin';
}

export async function getAdminLang(): Promise<AdminLang> {
  if (!(await mayChooseAdminLang())) return 'en';
  const chosen = (await cookies()).get(ADMIN_LANG_COOKIE)?.value;
  return isAdminLang(chosen) ? chosen : defaultAdminLang();
}

export async function getAdminT(): Promise<AdminT> {
  return makeAdminT(await getAdminLang(), BG_ADMIN);
}
