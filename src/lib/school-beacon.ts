// M21 (docs/adr/0024-trial-lessons.md): one event of a public school for its counters
// (POST /api/school-stats, schools.track): a view of its page, an opening of its pin or card, a
// click on its contact or website. navigator.sendBeacon where it exists (it survives a navigation),
// else a keepalive fetch; a failure is ignored. Nothing about the visitor is sent.

export type SchoolBeaconEvent = 'page_view' | 'pin_open' | 'contact_click';

export function trackSchool(schoolId: string, event: SchoolBeaconEvent): void {
  if (typeof window === 'undefined') return;
  const body = JSON.stringify({ schoolId, event });
  try {
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon('/api/school-stats', new Blob([body], { type: 'text/plain' }))) return;
    void fetch('/api/school-stats', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => undefined);
  } catch {
    // Counting never gets in the way.
  }
}
