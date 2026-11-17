// The control panel's frame (owner request 2026-11-17, docs/adr/0035-control-panel.md): the
// grouped navigation of every /admin page beside (from 1024 px) or above the page. Each page still
// guards itself (guardRoute): the navigation is only a way there. It reads the session, so it
// streams in behind <Suspense>; the fallback keeps its room, so the page does not move (CLS).
// Only a staff session that passed the second factor gets the navigation, and only the sections
// its role may open (checkRoute, the same decision the pages make).

import { headers } from 'next/headers';
import { Suspense, type ReactNode } from 'react';

import { AdminNav } from '@/components/admin/admin-nav';
import { hasStaff2FA } from '@/server/auth/guards';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';
import { adminNavGroups } from './nav-sections';

async function AdminNavEntry() {
  const principal = await getRequestPrincipal();
  if (!principal || !hasStaff2FA(principal)) return null;
  // The counts are a convenience: if they cannot be read, the links still show.
  const counts = await serverClient(await headers(), principal)
    .admin.navCounts()
    .catch(() => null);
  return <AdminNav groups={adminNavGroups(principal, counts)} />;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div data-admin-nav-slot="" className="min-h-[3.75rem] border-b border-border-subtle lg:min-h-0 lg:border-r lg:border-b-0">
        <Suspense fallback={null}>
          <AdminNavEntry />
        </Suspense>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
