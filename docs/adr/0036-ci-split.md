# ADR 0036: CI split over parallel machines

Date: 2026-11-17. Status: accepted (owner request, 2026-11-17).

## Context

`scripts/verify.sh all` ran on one 4-core runner and took about 97 minutes (run 44150275375):
E2E 73 minutes (three device projects, every spec), checks:M13 12 minutes (perf:api and perf:web,
Lighthouse on every main route), test:int 3 minutes, everything else under 5 minutes. The owner
asked for faster CI with no member-page check dropped; the repository is public, so parallel
runners cost nothing.

## Decision

1. The `verify` job is a matrix of six machines, each with its own PostgreSQL, Mailpit and
   SeaweedFS: `checks` (every step and every `scripts/verify.d/*.sh` except E2E), `e2e 1/4` to
   `e2e 4/4` (Playwright's `--shard` of the ordinary run, every project, the visual project
   included), and `e2e serial` (the @vitals run and the exclusive run, each alone on its machine,
   then the pilot run). `scripts/verify.sh` selects the part with `VERIFY_PART`
   (`checks`, `e2e-shard` with `E2E_SHARD=<n>/<total>`, `e2e-serial`); unset, it runs everything on
   one machine exactly as before, which stays the local and milestone contract.
2. Pull requests leave the pilot run (`VERIFY_PILOT=1`) and the two M13 measurements
   (`VERIFY_PERF=later`: perf:api, perf:web) to pushes to main, a nightly run on main (01:00 UTC)
   and `workflow_dispatch`. The skipped lines are printed as skips, never as passes.
3. The required check stays `ci`; it passes only when every machine of the matrix passed.

## Consequences

- A pull request run takes roughly the slowest shard plus set-up (about 25 to 35 minutes).
- A regression that only the pilot run or the measurements catch shows on main or the next
  nightly run instead of on the pull request; it is fixed in a follow-up pull request.
- Shards are split by test, so a spec's tests may run on different machines: tests must not rely on
  another test of the same file having run first (they already may not: `fullyParallel: true`).
