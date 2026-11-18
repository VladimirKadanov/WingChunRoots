// POST /api/admin/language (owner request 2026-11-18, docs/adr/0043-admin-bulgarian.md): the
// control panel's language switch. A plain form post from the control panel's navigation, so it
// works with scripts off: it keeps a full administrator's choice in a cookie scoped to /admin and
// answers 303 to the page it came from (only an /admin address; /admin otherwise). A display
// preference, not data: no service, no oRPC procedure, no audit entry. Anyone but a full
// administrator, or a post from another origin, changes nothing and is sent back the same way;
// the body is read only after the role check.

import { NextResponse } from 'next/server';

import { mayChooseAdminLang } from '@/components/admin/i18n/server';
import { ADMIN_LANG_COOKIE, isAdminLang } from '@/components/admin/i18n/translate';
import { appUrl } from '@/server/auth/env';

const YEAR_S = 365 * 24 * 60 * 60;

/** `back` when it is an /admin address on this site, else /admin. */
function adminBack(back: unknown): string {
  if (typeof back !== 'string') return '/admin';
  return /^\/admin(?:[/?#]|$)/.test(back) && !back.includes('\\') ? back : '/admin';
}

export async function POST(request: Request): Promise<Response> {
  const origin = new URL(appUrl()).origin;
  const sameOrigin = request.headers.get('origin') === origin;
  if (!sameOrigin || !(await mayChooseAdminLang())) {
    return NextResponse.redirect(new URL('/admin', origin), 303);
  }
  const form = await request.formData().catch(() => null);
  const lang = form?.get('lang');
  const response = NextResponse.redirect(new URL(adminBack(form?.get('back')), origin), 303);
  if (isAdminLang(lang)) {
    response.cookies.set(ADMIN_LANG_COOKIE, lang, { path: '/admin', maxAge: YEAR_S, sameSite: 'lax', secure: origin.startsWith('https:') });
  }
  return response;
}
