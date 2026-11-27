// Journey review P2-8 (docs/adr/0084-me-tab.md): the phone tabs for this request's session.
// Signed in: Home, Lineage, Schools, Events and Me (the dashboard, with the unread count);
// otherwise the five destinations. Reads the session, so the shell renders it inside <Suspense>
// with the signed-out tabs as the fallback. Never cached: per request, own data only.

import { MeIcon } from '@/components/icons';
import { getRequestPrincipal } from '@/server/auth/web';
import { loadMenu } from './account-entry';
import { NavLinks } from './nav-links';

export async function SessionTabs() {
  const principal = await getRequestPrincipal();
  if (!principal) return <NavLinks variant="tabs" />;
  let unread = 0;
  try {
    unread = (await loadMenu())?.unreadNotifications ?? 0;
  } catch {
    // A slow or failed read never breaks the tabs: Me still opens the dashboard.
  }
  return <NavLinks variant="tabs" session={{ me: <MeDrawing unread={unread} /> }} />;
}

/** The Me tab's head and shoulders, with the unread count where phones draw it (and in words for a screen reader). */
function MeDrawing({ unread }: { unread: number }) {
  return (
    <span className="relative inline-flex">
      <MeIcon size={23} />
      {unread > 0 ? (
        <span
          data-testid="me-tab-unread"
          className="absolute -top-1.5 -right-2.5 min-w-[1.15rem] rounded-full bg-fg px-1 text-center text-caption leading-[1.15rem] font-semibold tracking-normal text-fg-inverse normal-case tabular-nums"
        >
          <span aria-hidden="true">{unread > 99 ? '99+' : unread}</span>
          <span className="sr-only">{unread === 1 ? '1 unread notice' : `${unread} unread notices`}</span>
        </span>
      ) : null}
    </span>
  );
}
