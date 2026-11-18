// The dashboard menu on every page below /dashboard (src/app/dashboard/layout.tsx,
// docs/adr/0039-member-navigation.md): the slot knows the address from its segments, so the
// current link is marked on the server.

import { DashboardNavEntry } from '../../nav-entry';

export const instant = false;

export default async function DashboardNavSlot({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return <DashboardNavEntry pathname={`/dashboard/${path.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/')}`} />;
}
