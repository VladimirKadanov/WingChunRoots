// Every Bulgarian entry of the control panel (docs/adr/0043-admin-bulgarian.md). BG_ADMIN_CLIENT is the
// part client components use; the admin layout sends only that part to the browser.

import type { AdminDict } from '../translate';
import { BG_SHELL } from './shell';
import { BG_SHELL_CLIENT } from './shell.client';
import { BG_DASHBOARD } from './dashboard';
import { BG_DASHBOARD_CLIENT } from './dashboard.client';
import { BG_ARCHIVE } from './archive';
import { BG_ARCHIVE_CLIENT } from './archive.client';
import { BG_REVIEW } from './review';
import { BG_REVIEW_CLIENT } from './review.client';
import { BG_ACCOUNTS } from './accounts';
import { BG_ACCOUNTS_CLIENT } from './accounts.client';
import { BG_GRANTS } from './grants';
import { BG_GRANTS_CLIENT } from './grants.client';
import { BG_BILLING } from './billing';
import { BG_BILLING_CLIENT } from './billing.client';
import { BG_REPORTS } from './reports';
import { BG_REPORTS_CLIENT } from './reports.client';
import { BG_ORGANIZATIONS } from './organizations';
import { BG_ORGANIZATIONS_CLIENT } from './organizations.client';
import { BG_SCHOOLS } from './schools';
import { BG_SCHOOLS_CLIENT } from './schools.client';
import { BG_SYSTEM } from './system';
import { BG_SYSTEM_CLIENT } from './system.client';

/** The client parts, by area. */
export const BG_CLIENT_PARTS: Readonly<Record<string, AdminDict>> = {
  shell: BG_SHELL_CLIENT,
  dashboard: BG_DASHBOARD_CLIENT,
  archive: BG_ARCHIVE_CLIENT,
  review: BG_REVIEW_CLIENT,
  accounts: BG_ACCOUNTS_CLIENT,
  grants: BG_GRANTS_CLIENT,
  billing: BG_BILLING_CLIENT,
  reports: BG_REPORTS_CLIENT,
  organizations: BG_ORGANIZATIONS_CLIENT,
  schools: BG_SCHOOLS_CLIENT,
  system: BG_SYSTEM_CLIENT,
};

/** The server-only parts, by area. */
export const BG_SERVER_PARTS: Readonly<Record<string, AdminDict>> = {
  shell: BG_SHELL,
  dashboard: BG_DASHBOARD,
  archive: BG_ARCHIVE,
  review: BG_REVIEW,
  accounts: BG_ACCOUNTS,
  grants: BG_GRANTS,
  billing: BG_BILLING,
  reports: BG_REPORTS,
  organizations: BG_ORGANIZATIONS,
  schools: BG_SCHOOLS,
  system: BG_SYSTEM,
};

export const BG_ADMIN_CLIENT: AdminDict = Object.assign({}, ...Object.values(BG_CLIENT_PARTS));

/** Everything: the server parts and the client parts (an entry may be in both; the test keeps them equal). */
export const BG_ADMIN: AdminDict = Object.assign({}, BG_ADMIN_CLIENT, ...Object.values(BG_SERVER_PARTS));
