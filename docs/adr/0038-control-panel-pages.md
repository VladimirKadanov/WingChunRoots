# ADR 0038: The control panel's lists (review queue, schools, organizations, billing, system)

Date: 2026-11-17. Status: accepted (owner request 2026-11-17: "a proper grid", desktop first). Builds on ADR 0035.

## Decision

- Every list is a server-rendered table: search, filters, sort and pages are links and GET forms, with their state in the URL. No client JavaScript is added to these routes (the review routes sit at the 170 kB budget). Shared parts are in `src/components/admin/table-parts.tsx` (header, saved views, count line, pager, status mark, the table classes that turn rows into cards under a 52rem container).
- Review queue: `review.list` takes `group` (the dashboard's groups, `REVIEW_GROUPS` in `review.ts`, kept equal to `REVIEW_KIND_GROUPS` by a unit test) and `age` (`1d`, `3d`, `7d`), and returns `counts` (all, mine, unassigned, late, by kind, by group) under the status filter only, and `asOf`, the time the waiting column measures to. A case waiting more than 3 days is "late" (DEFAULT, no D number: a pilot number, easy to change in `REVIEW_LATE_DAYS`).
- `schools.adminList` takes `q` and `page` and returns `total`; a page is 50 schools (it was one list of up to 200).
- `organizations.adminList` takes `q`, `status`, `plan` and `page` (50 a page) and returns counts by approval. The plan filter is applied after the plan is read, over at most 500 organizations, as before.
- `billing.adminList` takes `plan` and `q` (account address or organization name) and returns `summary`: live subscriptions, their monthly value at the proposed prices (`monthlyValueCents`, as the dashboard), failed payments, plans ending at the period end, counts by status and value by plan. The figures ignore the filters.
- System status lists its problems first and puts the sections that need attention before the others.

## Consequences

- Search uses `ILIKE` with `%`, `_` and `\` escaped (`likePattern`), as the accounts table.
- New visual baselines for the changed admin pages come from CI.
