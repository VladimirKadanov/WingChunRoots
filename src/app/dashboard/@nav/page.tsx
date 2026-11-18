// The dashboard menu on /dashboard (src/app/dashboard/layout.tsx, docs/adr/0039-member-navigation.md).

import { DashboardNavEntry } from '../nav-entry';

export const instant = false;

export default function DashboardNavSlot() {
  return <DashboardNavEntry pathname="/dashboard" />;
}
