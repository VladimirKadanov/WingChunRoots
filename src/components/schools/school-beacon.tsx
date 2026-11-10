'use client';

// M21 (docs/adr/0024-trial-lessons.md): the counters of a public school page. One page view when the
// page is shown, and one contact click for a press on a link marked data-school-contact (the
// website, the e-mail, the phone). Renders nothing; nothing about the visitor is sent
// (src/lib/school-beacon.ts). The school's own account, staff and bots are left out on the server.

import { useEffect } from 'react';

import { trackSchool } from '@/lib/school-beacon';

export function SchoolBeacon({ schoolId }: { schoolId: string }) {
  useEffect(() => {
    trackSchool(schoolId, 'page_view');
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest('[data-school-contact]') : null;
      if (target) trackSchool(schoolId, 'contact_click');
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [schoolId]);
  return null;
}
