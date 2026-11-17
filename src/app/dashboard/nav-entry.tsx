// The dashboard menu's entry (docs/adr/0036-member-navigation.md): reads the session and the
// account's menu data per request; nothing for a visitor (the page itself sends them to sign in).
// The counts are a convenience: if the read fails, the page still works without the menu.

import { headers } from 'next/headers';

import { DashboardNav, dashboardNavGroups } from '@/components/dashboard/dashboard-nav';
import { getRequestPrincipal } from '@/server/auth/web';
import { serverClient } from '@/server/rpc/server';

export async function DashboardNavEntry({ pathname }: { pathname: string }) {
  const principal = await getRequestPrincipal();
  if (!principal) return null;
  const nav = await serverClient(await headers(), principal)
    .dashboard.nav()
    .catch(() => null);
  if (!nav) return null;
  return <DashboardNav groups={dashboardNavGroups(nav)} pathname={pathname} />;
}
