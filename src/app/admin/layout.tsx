// The control panel's frame (owner request 2026-11-17, docs/adr/0035-control-panel.md): the
// grouped navigation of every /admin page beside (from 1024 px) or above the page, from the @nav
// slot (src/app/admin/@nav: it knows the address, so the current link is marked on the server with
// no script). Each page still guards itself (guardRoute): the navigation is only a way there. It
// reads the session, so it streams in behind <Suspense>; its slot keeps its room, so the page does
// not move (CLS). Only a staff session that passed the second factor gets the navigation, and only
// the sections its role may open (checkRoute, the same decision the pages make).
//
// Language (docs/adr/0043-admin-bulgarian.md): a full administrator reads the control panel in
// Bulgarian unless they switch to English; every other role reads English. The frame carries the
// lang attribute, and client components get only the Bulgarian they use (BG_ADMIN_CLIENT).

import { Suspense, type ReactNode } from 'react';

import { BG_ADMIN_CLIENT } from '@/components/admin/i18n/bg';
import { AdminTProvider } from '@/components/admin/i18n/client';
import { getAdminLang } from '@/components/admin/i18n/server';

export const instant = false;

export default async function AdminLayout({ children, nav }: { children: ReactNode; nav: ReactNode }) {
  const lang = await getAdminLang();
  return (
    <AdminTProvider lang={lang} dict={lang === 'bg' ? BG_ADMIN_CLIENT : {}}>
    <div lang={lang} className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div data-admin-nav-slot="" className="min-h-[3.75rem] border-b border-border-subtle lg:min-h-0 lg:border-r lg:border-b-0">
        <Suspense fallback={null}>{nav}</Suspense>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
    </AdminTProvider>
  );
}
