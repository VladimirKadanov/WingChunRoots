# ADR 0041: The control panel's reports

Date: 2026-11-17. Status: accepted (owner request 2026-11-17, mockup Reports.dc.html). Builds on ADR 0035 and ADR 0038.

## Decision

- `/admin/reports` shows one report at a time (`?report=growth|review|archive|schools|billing`) over a period (`?period=30d|90d|12m`, DEFAULT `90d`). The report list and the period are links and a GET form; the page adds no client JavaScript (153.9 kB, the admin baseline).
- Periods are buckets that end with the current one: 5 or 13 ISO weeks (Monday 00:00 UTC, as the dashboard's growth chart) or 12 calendar months (UTC). DEFAULT, no D number: weekly buckets for 30 and 90 days, monthly for 12 months, so a chart never has more than 13 groups.
- Two procedures: `admin.reports` (`GET /admin/reports`, any staff role with a verified second factor) for growth, review throughput, archive completeness and schools; `admin.billingReport` (`GET /admin/reports/billing`, administrators only, as `/admin/billing`). In the review report the account deletion group is shown to administrators only, as on the dashboard.
- Aggregate rows only. No row names a person, an account or an e-mail address. Lineages, countries and cities are named (the archive editor and the school list already show them). Schools are counted by the city of their `place`; a point (`public_point`, the centroid) is never read.
- Definitions, from what the schema keeps (nothing estimated): a link is *established* when `verified` or `in_arbitration`; *sourced* when it has an archivist's `source_note` or an evidence file linked to it or to a review case about it. *Decided* review cases are `resolved` or `dismissed` with `resolved_at` in the period; the median is `percentile_cont(0.5)` of `resolved_at - created_at`. *Appealed* counts `decision_appeal` rows created in the period, by the appealed case's group. A subscription is *running* at a bucket's end when it was not `incomplete`, started before the end and had not ended; it is valued at its current plan, since plan changes are not kept as history (`monthlyValueCents`, as the dashboard).
- CSV: `GET /api/admin/reports/<table>?period=` (a route handler over the same procedures; 404 for an unknown table and for a cookie request from another site, 401/403 from the procedure). One file per table, the page's rows, RFC 4180 quoting, CRLF, and a leading apostrophe on any text a spreadsheet would run as a formula. `Cache-Control: no-store`, `Content-Disposition: attachment`.
- Exact counts, not "fewer than 5". DEFAULT, no D number: the mockup suppressed counts under 5, but every figure here is an aggregate of records the same staff can already open one by one, and in a pilot almost every cell would read "fewer than 5". Revisit if reports are ever shown outside the staff.
- Charts are server-rendered SVG bars on one axis from zero; two series differ by shape (filled and outlined bars) as well as tone; each bar has a `<title>` and the numbers are in an sr-only table.

## Consequences

- The growth report's "schools" series counts schools that are listed now, by the day they were added: a school listed and later hidden drops out of past buckets.
- The billing report's past buckets use today's plan of each subscription.
- New visual baselines for `/admin/reports` come from CI.
