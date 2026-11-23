// The dashboard's frame (owner request 2026-11-17, docs/adr/0039-member-navigation.md): the
// grouped menu of every /dashboard page beside (from 1024 px) or above the page, from the @nav
// slot (src/app/dashboard/@nav: it knows the address, so the current link is marked on the server
// with no script). Each page still guards itself (guardRoute): the menu is only a way there. It
// reads the session, so it streams in behind <Suspense>; its slot keeps its room, so the page does
// not move (CLS). Below 1024 px the slot is sized by the page, not by its row of links
// (contain: inline-size), so a long page name is cut inside it instead of widening the page. On paper (ADR
// 0046, the passport's print view) the menu is left out.

import { Suspense, type ReactNode } from 'react';

export default function DashboardLayout({ children, nav }: { children: ReactNode; nav: ReactNode }) {
  return (
    <div className="lg:grid lg:grid-cols-[15rem_minmax(0,1fr)] print:block">
      <div data-dashboard-nav-slot="" className="min-h-16 border-b border-border-subtle max-lg:[contain:inline-size] lg:min-h-0 lg:border-r lg:border-b-0 print:hidden">
        <Suspense fallback={null}>{nav}</Suspense>
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
