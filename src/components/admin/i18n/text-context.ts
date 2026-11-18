'use client';

// The smallest part of the control panel's language, for components the whole site shares (the
// field label's "(optional)" and the form summary): only the Bulgarian text map, empty
// outside the control panel of a full administrator, so those components read English everywhere
// else and the site's pages carry no translation code (docs/adr/0043-admin-bulgarian.md).

import { createContext, useContext } from 'react';

import type { AdminDict } from './translate';

export const AdminTextContext = createContext<AdminDict>({});

/** The Bulgarian text map where a full administrator reads Bulgarian; empty everywhere else (look up with `?? text`). */
export function useAdminText(): AdminDict {
  return useContext(AdminTextContext);
}
