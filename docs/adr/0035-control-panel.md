# ADR 0035: Control panel and account menu

Date: 2026-11-17. Status: accepted (owner request 2026-11-17: "a modern control panel", "a proper submenu when I am logged in").

## Decision

1. **Account entry in the shell.** Signed out: "Sign in" (phone bar) and "Sign in" + "Create account" (rail). Signed in: a round mark with the account's initials opens the account menu: name, address, role, then My dashboard, My profile, Notifications (with the unread count), Plan and billing, Account and security, Privacy and your data, Control panel (staff only) and Sign out. The data comes from `account.menu` (the account's own data only). The entry sits behind Suspense with a fixed-size fallback, so static pages stay static and nothing shifts.
2. **No client script for either.** Most routes sit at the 170 kB budget (plan §5.8 (c)). The menu uses the browser's Popover API (`popovertarget`, `popover="auto"`: Escape, outside click and focus return are native), CSS anchor positioning with fixed corners where unsupported, plain links and a server-action sign-out form. Clearing the recent searches after sign-out moved to `/sign-in?signed-out=1`. It is a disclosure of navigation links, not an ARIA menu.
3. **Control panel navigation.** Every `/admin` page has the same grouped navigation (Overview, Queues, Directory, Archive, Money, System): a sidebar from 1024 px, a sideways-scrolling row of links on phones. The current section is marked with `aria-current`, weight, an ink bar and the surface, never colour alone. The `@nav` parallel route slot knows the address, so the mark needs no script. A section shows only when `checkRoute` would open its page for the session, so each role sees its own sections. Counts (open review cases, system problems) come from `admin.navCounts`.
4. **Dashboard.** `admin.dashboard`: accounts, people, verified links (totals and the last 30 days), schools by stage, the review queue by group, assigned to me and unassigned, oldest open, 12 weeks of growth, system problems (failed jobs, failed e-mails, last backup), deletion requests and, for administrators only, paid plans and their monthly value at the proposed test-mode prices (a yearly plan counts as a twelfth).
5. **Accounts table.** `accounts.list` (administrators): every account but erased ones, searchable by address and profile name, filters by role and state (suspended, unconfirmed, staff), four orders, 25 a page, GET parameters only.
6. **iPhone run.** Staff work on desktop, so the CI's mobile-webkit project leaves out tests tagged `@admin` or naming an `/admin` address in their title (`ADMIN_GREP`, e2e/projects.ts). Desktop and Pixel still run them; member pages keep the iPhone run (owner request 2026-11-17).

## Consequences

- New admin sections are added to `src/app/admin/nav-sections.tsx` with a route policy.
- Member pages that want the same pattern can reuse the server-only `AdminNav` approach.
