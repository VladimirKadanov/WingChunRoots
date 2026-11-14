# Review 2026-11-14, "retention and withdrawal": questions and defaults

Context: the owner's decisions of 2026-11-14 (items 3 and 4 of the second round): set retention periods and add the purge jobs, write the
restore-then-replay step, add the withdrawal of a trial lesson request by its sender and purge such requests when their school goes. Findings:
`review-2026-11-13/privacy.md` (2, 4, 5), `flows-core.md` M5, `flows-community.md` N6. Main a6ce335.
The owner left the numbers to us. Everything below that carries `DEFAULT review-2026-11` is a default taken without the owner; change the
number in the one constant named for it and the guide text follows (docs/guides/admin-guide.bg.md, "Автоматично изтриване").

## Questions

### Q1 (2026-11-14) How long does a record made for a third party who never joined stay?

- Question: a member who invites a teacher, or names a historical teacher, makes a `person` record (names, search keys) for someone who may never join. When does it go if no link was ever verified?
- Options: (a) 60 days after the last invitation, claim or request about it ended; (b) 30 days (the minimum of the review); (c) 90 days (the maximum).
- Proposed default: (a), `THIRD_PARTY_RECORD_RETENTION_DAYS = 60` in `src/server/services/retention-records.ts`. It is longer than the 30 days an invitation's address is kept, so a student who is slow to send a second link still finds the record. Only a record with the audit row `person.create` and the reason `invited teacher` or `historical teacher claim` is ever purged (seeds, organization imports and archival records are never), and never one with a live relationship, an open case, a pending claim, an invitation that can still be used, or a tie to an organization, school, event, lineage or passport. Where a relationship (append-only history) still refers to the record, it stays as a removed, nameless row ("A removed profile"); otherwise it is deleted. A request that waited for the teacher to join is withdrawn first.

### Q2 (2026-11-14) How long does the text of a record revision stay?

- Question: `record_revision` keeps the before and after text of every archival edit (a name or biography corrected after a complaint stays readable in `before`).
- Options: (a) redact after 13 months; (b) after 90 days; (c) never, but only for the committee.
- Proposed default: (a), `RECORD_REVISION_TEXT_RETENTION_MONTHS = 13`: long enough for an appeal or a yearly review, the same period as `ip_hmac` (Q4). Who, when, which fields, the reason and the case stay; each redacted text becomes `[redacted: N characters]`. Done by the database function `redact_record_revisions()` (the table stays append-only for the application). The revisions of a record that is purged (Q1) are redacted at once. For an erased member's record the revisions of the kept record are redacted too (ADR 0032).

### Q3 (2026-11-14) How long do evidence and review notes of a refused or withdrawn claim stay?

- Question: M10a question 2 (open since M10a): files of a refused or withdrawn claim stay forever in the private bucket and in `--objects` copies.
- Options: (a) 90 days after the claim closed; (b) 6 or 12 months (M10a's own suggestion); (c) keep until the owner decides.
- Proposed default: (a), `ENDED_CLAIM_RETENTION_DAYS = 90`. `retention_until` is set when a file becomes due; the object is deleted from the private bucket and the row marked deleted (the name and hash of the original go too). A file a verified link rests on, an archival edit, or any open case rests on is kept (the same rule as the account erasure of ADR 0030). The text of the review notes of those claims is removed at the same time. Only claim cases (`historical_claim`, `person_claim`, `instructor_verification`) and the evidence of a rejected or withdrawn relationship are covered.
- Not done, for the owner to decide: the text of `record_proposal.proposed` and `.base` (a member's proposed change to a shared record, kept for decided proposals as the revisions were; the same 13 months and the same redaction would fit, and it needs no new rule, only a decision that proposals count as revisions); files that were uploaded and never attached to anything (M10a proposed 24 hours); the claimant's message (`person_claim.message`), the reviewers' `resolution_reason` and `teaching_relationship.status_reason`; evidence of an approved profile claim; evidence of other case kinds (disputes, appeals, reports).

### Q4 (2026-11-14) How long does `ip_hmac` stay, and when is the key changed?

- Question: notice §3 promises a yearly change of the key and the destruction of the old one; the code has one key and no tooling.
- Options: (a) null the values after 13 months and change the key once a year (runbook); (b) 6 months; (c) keep.
- Proposed default: (a), `IP_HMAC_RETENTION_MONTHS = 13`: `audit_log.ip_hmac` (through `null_old_audit_ip_hmac()`, the one change the append-only log allows) and `auth_session.ip_address` are set to NULL after 13 months, and the key is changed every 12 months: no value is older than 13 months, and one key links at most 12 months of activity (the old key is destroyed at each change, so the older values can no longer be matched with new ones, as the notice says). The runbook is `docs/operations/ip-hmac-rotation.md`.

### Q5 (2026-11-14) How long does an unanswered trial lesson request stay open?

- Question: an open request holds the sender's name, contact and message until someone answers; nothing closed it.
- Options: (a) close it after 90 days and remove the sender's name, contact, times and message; (b) 30 days; (c) never.
- Proposed default: (a), `TRIAL_OPEN_INQUIRY_DAYS = 90` (`src/server/db/schema/common.ts`). The sender sees "Closed"; nobody is told. A closed row (answered, declined, closed, withdrawn) is still deleted 365 days after it closed, as today. Also: every open request of a school that is hidden by a moderator (status `hidden`), archived or removed is closed and scrubbed the same way by the daily job.
- A request the sender withdraws is scrubbed at once. Only an open request can be withdrawn; an answered, declined or closed one keeps its data until the 365 days. Option for later: "Remove my details" on those too.

### Q6 (2026-11-14) Where does the erasure ledger live, and what happens when it cannot be written?

- Question: a restored backup brings back accounts and requests that were erased after the dump.
- Options: (a) an append-only file next to the backups (`<BACKUP_DIR>/erasures/ledger.ndjson`, `ERASURE_LEDGER_DIR` to move it); (b) a table in a second database; (c) only a written step, no mechanism.
- Proposed default: (a), see ADR 0032. Ids and times only, no names or addresses. An erasure is refused (nothing changes) if the ledger cannot be written, because an erasure that no restore can repeat is worse than a delayed one. `// DEFAULT review-2026-11:` in `src/server/erasure-ledger.ts`.

### Q7 (2026-11-14) How long can an erased person still exist in a backup?

- Question: the notice should say how long.
- Answer to quote: up to 14 dumps (`BACKUP_KEEP`, one a day by the cron in the guide), so up to 14 days in the archive, plus the time an off-site copy is kept if the owner keeps one. A restored dump is brought back to the erased state by `pnpm erasures:replay` before anyone uses it (docs/operations/backup-and-restore.md).

## Not in scope (flagged, not touched)

- The privacy notice text: only a contradiction with the code would be changed, and none was found by this work; the notice still has to name the new periods (counsel and owner).
- A data export, lineage rules, billing, hosting.

## Progress

- 2026-11-14 checkpoint 1: schema and migration (`trial_inquiry.scrubbed_at`, the status `withdrawn`, the audit-log exception for `ip_hmac`, the three redaction functions), the five new retention steps in the daily job (`src/server/services/retention-records.ts`) with integration tests, trial withdrawal (service, `trial.withdraw`, the sender's list, the school's inbox).
- 2026-11-14 checkpoint 2: the erasure ledger (`src/server/erasure-ledger.ts`: begin before the change inside the transaction, done after the commit, aborted after a refusal; fail closed), written by `eraseAccount` and `withdrawTrial`; `pnpm erasures:replay` (dry run by default, `--apply`, `--include-unconfirmed`; local only); check 11 of `scripts/restore-drill.sh` (a fictional account erased after the archive is removed from the restored copy); the text of the revisions of an erased member's kept record is redacted (`redact_person_revisions`); Compose mounts the ledger folder read-write at `/erasures`.
- 2026-11-14 checkpoint 3: documentation (ADR 0032; `docs/operations/backup-and-restore.md` and `incident.md` with the restore-then-replay step and the 14-dump statement; `docs/operations/ip-hmac-rotation.md`; the admin guide, section 33 "Автоматично изтриване", and the user guide; `docs/data-model.md` §2, §7, §8) and an end-to-end test of the sender's withdrawal.
- 2026-11-14 checkpoint 4 (code review of the branch): a ledger that cannot be written now reaches an administrator, the command line and the member as a refusal (`CONFLICT`, `services/ledger-guard.ts`), not as "Internal server error", and is checked before an erasure ends the subscriptions; every `retention.purge` step runs even when another fails (the old steps too; each failure logs `step <name> failed (<code>)`, the first error is rethrown for the retry); a revoked invitation ends at its own last change while its address is still there; a purged third party's evidence files and the personal columns of the removed row go with it; a request that the 90-day job already closed says so, instead of "closed by the school". Checked and left as it is: the retention queries use the existing indexes (`audit_log_subject_idx`, `invitation_person_id_idx`, `person_claim_person_id_idx`, `review_case_person_id_idx`, the relationship cover indexes); hidden schools are scrubbed as the owner's decision asked (a moderator's `hidden` is not set by any code today, the daily sweep covers it when it is).
