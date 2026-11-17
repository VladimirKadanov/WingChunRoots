// The dashboard's frame (owner request 2026-11-17, docs/adr/0036-member-navigation.md): the
// grouped menu of every /dashboard page beside (from 1024 px) or above the page, from the @nav
// slot (src/app/dashboard/@nav: it knows the address, so the current link is marked on the server
// with no script). Each page still guards itself (guardRoute): the menu is only a way there. It
// reads the session, so it streams in behind <Suspense>; its slot keeps its room, so the page does
// not move (CLS).

import { Suspense, type ReactNode } from 'react';

export default function DashboardLayout({ children, nav }: { children: ReactNode; nav: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
      <div data-dashboard-nav-slot="" className="min-h-[3.75rem] border-b border-border-subtle lg:min-h-0 lg:border-r lg:border-b-0">
        <Suspense fallback={null}>{nav}</Suspense>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
