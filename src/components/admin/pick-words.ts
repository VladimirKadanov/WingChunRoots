// The words of "Find by name" beside a record address in the control panel (role replay 2026-11-25,
// P2-4; src/components/ui/search-pick.tsx). Shared by the archive editor's forms (client) and the
// review queue's record lookup (server), so it lives outside both.

import type { AdminT } from '@/components/admin/i18n/translate';
import type { SearchPickWords } from '@/components/ui/search-pick';

export function pickWords(t: AdminT, dialog: string): SearchPickWords {
  return {
    find: t('Find by name'),
    dialog,
    hint: t('Type the name in any spelling. Only public records are found; type the address of any other record.'),
    chosen: t('Chosen: {name}'),
  };
}
