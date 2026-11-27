// Journey review P2-8 (docs/adr/0084-me-tab.md): the last two phone tabs for this request's
// session. Signed in: Events and Me (the dashboard, with the unread count); otherwise
// Organizations and Events. Reads the session, so the shell renders it inside <Suspense> with the
// signed-out tabs as the fallback. Never cached: per request, own data only.

import { getRequestPrincipal } from '@/server/auth/web';
import { loadMenu } from './account-entry';
import { TabTail } from './nav-links';

export async function SessionTabTail() {
  const principal = await getRequestPrincipal();
  if (!principal) return <TabTail signedIn={false} />;
  let unread = 0;
  try {
    unread = (await loadMenu())?.unreadNotifications ?? 0;
  } catch {
    // A slow or failed read never breaks the tabs: Me still opens the dashboard.
  }
  return <TabTail signedIn unread={unread} />;
}
