# Review 2026-11-13, PR A "safety net": questions and defaults

Context: the full review of 2026-11-13 (`review-2026-11-13/ops.md`, `auth.md`, `uploads.md`), main 63dcb05.
Everything below that carries `DEFAULT review-2026-11` is a default taken without the owner, safest option first.

## Questions

### Q1 (2026-11-13) BACKUP_AGE_RECIPIENT is set but `age` is not on PATH

- Question: should `scripts/backup-local.sh` fail, or write a plain archive?
- Options: (a) write the plain archive and print a loud warning on stderr; (b) fail the backup.
- Proposed default: (a). `age` is optional by the task's own rule; a failing nightly backup is worse than a plain one for data loss, and the warning is in `backup.log`. `// DEFAULT review-2026-11:` in `scripts/backup-local.sh`.

### Q2 (2026-11-13) Versioned secrets (`BETTER_AUTH_SECRET` rotation)

- Out of scope for PR A. Rotating `BETTER_AUTH_SECRET` makes every stored TOTP secret unreadable (Better Auth encrypts them with it). PR A adds `pnpm account:reset-2fa` so staff can re-enrol after a rotation, but a rotation still logs everyone out and invalidates all TOTP secrets at once.
- Options: (a) leave as is and document; (b) use Better Auth's versioned secrets (`secrets: [{ version, value }]`) so an old key still decrypts while a new one signs.
- Proposed default: (a) until the owner decides on (b).

### Q3 (2026-11-13) Body limits of the public routes

- Question: how large a body may `/api/auth/*`, `POST /unsubscribe/one-click` and `POST /api/internal/revalidate` read? (`/api/rpc`, `/api/v1`, the evidence upload, the billing webhook and `/api/school-stats` already had limits.)
- Options: (a) one small cap per route, sized from the largest legitimate body; (b) reuse the 1 MiB JSON cap of `/api/rpc` everywhere.
- Proposed default: (a): `/api/auth` 64 KiB (the largest real body is a sign-up form of a few hundred bytes), `/unsubscribe/one-click` 8 KiB (the form is 26 bytes), `/api/internal/revalidate` 256 KiB (2000 tags of the longest shape are about 130 KB). Over the cap: 413, by the declared Content-Length first and by counting the stream otherwise (a chunked body is allowed, never 411: a mail client may send the one-click form chunked). `// DEFAULT review-2026-11:` in `src/server/auth/route.ts`, `src/server/one-click.ts`, `src/server/revalidate.ts`.

## Progress

- 2026-11-13 Task 1 (complete backups): `scripts/lib/object-families.ts` lists the five object families (evidence, certificate, person_photo, school_photo, event_poster); `backup-local.sh --objects` copies all of them, `restore-drill.sh` samples each and fails on a missing object; optional `age`; unit tests (`object-families.test.ts` fails when a table with a storage key is not covered, `object-archive.test.ts`), integration test `src/server/backups-objects.int.test.ts`; backup/restore doc and admin guide updated. Verified by hand against the seeded test database: plain and age-encrypted backup, drill pass, drill FAIL with a missing rendition and a missing family.
- 2026-11-13 Task 2 (reset/seed guard): `src/server/db/wipe-guard.ts`; `db:seed` and `db:reset` refuse a database holding a `person`/`school`/`organization`/`lineage`/`event` slug without `demo-` or an `auth_user` outside the reserved `.test` domain, unless `WCR_ALLOW_WIPE=1`; counts only in the message. `scripts/verify.sh` sets `WCR_ALLOW_WIPE=1` for its own `db:reset` of the test database (it holds the previous E2E run's rows); integration tests create fresh databases and pass unchanged. Unit tests for the decision, integration tests against real databases (empty, demo-only, one non-demo row, override); `local-run.md`, admin guide and README updated.
- 2026-11-13 Task 3 (bounded request bodies): `src/server/http-body.ts` (leaf: declared-length refusal, counted stream read, 413 in the project's plain error shape) is shared by `/api/rpc` and `/api/v1` (`boundedRequest`, behaviour unchanged), `/api/auth/*` (64 KiB), `/unsubscribe/one-click` (8 KiB, logic moved to `src/server/one-click.ts` because a Next.js route file may export only handlers) and `/api/internal/revalidate` (256 KiB). Audit of every `src/app/**/route.ts`: the others were already bounded (`school-stats` 512 B, billing webhook 256 KiB, evidence upload 20 MB with a required length, `rpc`/`v1`) or take no body. Unit tests (`http-body.test.ts`, `auth/route.test.ts`), integration tests (`one-click.int.test.ts`, `revalidate.int.test.ts`) and a real-HTTP spec (`e2e/request-bodies.spec.ts`: exact-limit and limit+1, declared and chunked); ADR 0016's "no body is read unbounded" corrected.
