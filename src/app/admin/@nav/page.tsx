// The control panel's navigation on /admin (src/app/admin/layout.tsx, docs/adr/0035-control-panel.md).

import { AdminNavEntry } from '../nav-sections';

export const instant = false;

export default function AdminNavSlot() {
  return <AdminNavEntry pathname="/admin" />;
}
