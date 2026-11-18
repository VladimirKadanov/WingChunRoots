// The control panel's navigation on every page below /admin (src/app/admin/layout.tsx,
// docs/adr/0035-control-panel.md): the slot knows the address from its segments, so the current
// link is marked on the server.

import { AdminNavEntry } from '../../nav-sections';

export const instant = false;

export default async function AdminNavSlot({ params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return <AdminNavEntry pathname={`/admin/${path.map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/')}`} />;
}
