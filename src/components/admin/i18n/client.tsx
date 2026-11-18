'use client';

// The control panel's language in client components (docs/adr/0043-admin-bulgarian.md). The admin
// layout (src/app/admin/layout.tsx) puts the language and only the Bulgarian text that client
// components use (bg/*.client.ts) in this context, so the pages' scripts carry no dictionary.

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { type AdminDict, type AdminLang, type AdminT, makeAdminT } from './translate';

const Ctx = createContext<{ lang: AdminLang; dict: AdminDict }>({ lang: 'en', dict: {} });

export function AdminTProvider({ lang, dict, children }: { lang: AdminLang; dict: AdminDict; children: ReactNode }) {
  const value = useMemo(() => ({ lang, dict }), [lang, dict]);
  return <Ctx value={value}>{children}</Ctx>;
}

export function useAdminT(): AdminT {
  const { lang, dict } = useContext(Ctx);
  return useMemo(() => makeAdminT(lang, dict), [lang, dict]);
}
